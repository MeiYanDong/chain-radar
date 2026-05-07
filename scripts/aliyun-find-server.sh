#!/usr/bin/env bash
set -euo pipefail

# Find an Alibaba Cloud server by public IP across Simple Application Server
# (SWAS), ECS public IPs, and EIP resources. The old chain-radar hosts are SWAS,
# so ECS-only lookup is not enough.

TARGET_IP="${1:-}"
if [[ -z "$TARGET_IP" ]]; then
  echo "usage: $0 <public-ip>" >&2
  exit 2
fi

if ! command -v aliyun >/dev/null 2>&1; then
  echo "aliyun CLI is required" >&2
  exit 1
fi

regions() {
  aliyun ecs DescribeRegions | node -e '
let s = "";
process.stdin.on("data", d => s += d);
process.stdin.on("end", () => {
  const j = JSON.parse(s);
  console.log((j.Regions?.Region || []).map(r => r.RegionId).join(" "));
});
'
}

print_swas() {
  local region="$1"
  aliyun swas-open list-instances \
    --biz-region-id "$region" \
    --public-ip-addresses "[\"$TARGET_IP\"]" \
    --page-number 1 \
    --page-size 100 2>/dev/null || true
}

parse_swas() {
  local region="$1"
  node -e '
let s = "";
process.stdin.on("data", d => s += d);
process.stdin.on("end", () => {
  if (!s.trim()) return;
  const j = JSON.parse(s);
  for (const x of j.Instances || []) {
    console.log([
      "SWAS",
      x.RegionId || process.argv[1],
      x.InstanceId,
      x.InstanceName,
      x.Status,
      x.PublicIpAddress,
      `cpu=${x.ResourceSpec?.Cpu ?? ""}`,
      `mem_gb=${x.ResourceSpec?.Memory ?? ""}`,
      `disk_gb=${x.ResourceSpec?.DiskSize ?? ""}`,
      `expires=${x.ExpiredTime ?? ""}`,
    ].join("\t"));
  }
});
' "$region"
}

print_ecs() {
  local region="$1"
  aliyun ecs DescribeInstances \
    --RegionId "$region" \
    --PublicIpAddresses "[\"$TARGET_IP\"]" \
    --PageSize 100 2>/dev/null || true
}

parse_ecs() {
  local region="$1"
  node -e '
let s = "";
process.stdin.on("data", d => s += d);
process.stdin.on("end", () => {
  if (!s.trim()) return;
  const j = JSON.parse(s);
  for (const x of j.Instances?.Instance || []) {
    const pub = (x.PublicIpAddress?.IpAddress || []).join(",");
    console.log([
      "ECS",
      x.RegionId || process.argv[1],
      x.InstanceId,
      x.InstanceName,
      x.Status,
      pub,
      x.InstanceType || "",
    ].join("\t"));
  }
});
' "$region"
}

print_eip() {
  local region="$1"
  aliyun vpc DescribeEipAddresses \
    --RegionId "$region" \
    --IpAddress "$TARGET_IP" \
    --PageSize 100 2>/dev/null || true
}

parse_eip() {
  local region="$1"
  node -e '
let s = "";
process.stdin.on("data", d => s += d);
process.stdin.on("end", () => {
  if (!s.trim()) return;
  const j = JSON.parse(s);
  for (const x of j.EipAddresses?.EipAddress || []) {
    console.log([
      "EIP",
      process.argv[1],
      x.AllocationId,
      x.Name || "",
      x.Status,
      x.IpAddress,
      x.InstanceType || "",
      x.InstanceId || "",
    ].join("\t"));
  }
});
' "$region"
}

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

for region in $(regions); do
  out="$(
    print_swas "$region" | parse_swas "$region"
    print_ecs "$region" | parse_ecs "$region"
    print_eip "$region" | parse_eip "$region"
  )"
  if [[ -n "$out" ]]; then
    printf "%s\n" "$out" >>"$tmp"
  fi
done

if [[ ! -s "$tmp" ]]; then
  echo "not found: $TARGET_IP" >&2
  exit 3
fi

sort -u "$tmp"
