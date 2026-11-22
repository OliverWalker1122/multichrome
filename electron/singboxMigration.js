import { isIP } from "node:net";
import { normalizeProxyConfig } from "./singboxConfig.js";

const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const NON_PROXY_TYPES = new Set(["direct", "block", "dns"]);
const REASONS = Object.freeze({
  INVALID_CONFIG: "源配置结构无效，未进行迁移",
  UNSUPPORTED_ROUTE_OPTIONS: "源配置包含无法保留的全局路由选项，未进行迁移",
  INVALID_NODE: "出口或端点缺少有效类型或标签",
  DUPLICATE_TAG: "出口或端点标签重复，无法确定引用目标",
  NON_PROXY: "直连、阻断和 DNS 出口不导入为浏览器代理",
  NON_PROXY_DEPENDENCY: "出口依赖直连、阻断或 DNS 出口，无法安全迁移",
  MISSING_DEPENDENCY: "出口引用的依赖不存在或标签重复",
  INVALID_DEPENDENCY: "出口依赖结构无效",
  CYCLIC_DEPENDENCY: "出口依赖形成循环",
  INVALID_FRAGMENT: "出口片段未通过托管配置结构校验",
  DNS_INBOUND_RULES: "DNS 规则依赖原入口标签，无法无损迁移到托管入口",
  UNSUPPORTED_INBOUND: "只自动绑定本地 SOCKS、HTTP 或混合代理入口",
  NON_LOCAL_INBOUND: "入口未明确监听回环地址，未自动绑定",
  INVALID_PORT: "入口没有固定的有效端口，未自动绑定",
  INBOUND_OPTIONS: "入口包含认证、嗅探或其他无法保留的设置，未自动绑定",
  CONDITIONAL_ROUTE: "入口存在条件路由或非转发动作，未自动绑定以免改变流量去向",
  INVALID_ROUTE: "入口路由结构无效或没有明确的出口目标，未自动绑定",
  TARGET_UNAVAILABLE: "入口所选出口无法安全导入，未自动绑定",
  MANAGED_HTTP_INBOUND: "托管代理使用本地 HTTP 入口，仅迁移浏览器 TCP 代理用途",
  RUNTIME_STATE: "运行时出口组选择和缓存不导入，出口组按 JSON 中的默认项启动",
  LEGACY_DNS: "DNS 保留原配置，旧版 DNS 语法仍需通过随附核心的校验",
});

function issue(code, location = {}) {
  return { ...location, code, reason: REASONS[code] };
}

function hasInboundCondition(value) {
  if (Array.isArray(value)) return value.some(hasInboundCondition);
  if (!isObject(value)) return false;
  return Object.entries(value).some(
    ([key, item]) => key === "inbound" || hasInboundCondition(item),
  );
}

function dnsDetours(value, references) {
  if (Array.isArray(value)) {
    value.forEach((item) => dnsDetours(item, references));
  } else if (isObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (key === "detour") references.push(item);
      else dnsDetours(item, references);
    }
  }
}

function nodeReferences(node) {
  const references = [];
  if (node.detour !== undefined) references.push(node.detour);
  if (node.type === "selector" || node.type === "urltest") {
    if (!Array.isArray(node.outbounds) || !node.outbounds.length)
      throw issue("INVALID_DEPENDENCY");
    references.push(...node.outbounds);
    if (node.default !== undefined && !node.outbounds.includes(node.default))
      throw issue("INVALID_DEPENDENCY");
  }
  return references;
}

function routeTarget(inboundTag, route, defaultTag) {
  for (const rule of route.rules ?? []) {
    if (!isObject(rule)) throw issue("INVALID_ROUTE");
    if (rule.type !== undefined && rule.type !== "default")
      throw issue("CONDITIONAL_ROUTE");
    let inboundTags = [];
    if (rule.inbound !== undefined) {
      inboundTags = Array.isArray(rule.inbound) ? rule.inbound : [rule.inbound];
      if (inboundTags.some((tag) => typeof tag !== "string"))
        throw issue("INVALID_ROUTE");
    }
    // A positive inbound condition can prove a rule irrelevant. An inverted
    // rule cannot: inversion applies to the entire match, not just inbound.
    if (
      rule.invert !== true &&
      inboundTags.length &&
      !inboundTags.includes(inboundTag)
    )
      continue;
    if (
      rule.invert === true ||
      Object.keys(rule).some(
        (key) =>
          !["type", "inbound", "outbound", "action", "invert"].includes(key),
      ) ||
      (rule.action !== undefined && rule.action !== "route")
    )
      throw issue("CONDITIONAL_ROUTE");
    if (typeof rule.outbound !== "string" || !rule.outbound)
      throw issue("INVALID_ROUTE");
    return rule.outbound;
  }
  const target = route.final || defaultTag;
  if (typeof target !== "string" || !target) throw issue("INVALID_ROUTE");
  return target;
}

function inboundAddress(inbound) {
  if (!isObject(inbound) || !["socks", "http", "mixed"].includes(inbound.type))
    throw issue("UNSUPPORTED_INBOUND");
  const listen = inbound.listen;
  if (
    listen !== "localhost" &&
    listen !== "::1" &&
    !(
      typeof listen === "string" &&
      isIP(listen) === 4 &&
      listen.startsWith("127.")
    )
  )
    throw issue("NON_LOCAL_INBOUND");
  const port = inbound.listen_port;
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw issue("INVALID_PORT");
  for (const [key, value] of Object.entries(inbound)) {
    if (["type", "tag", "listen", "listen_port"].includes(key)) continue;
    if (key === "users" && Array.isArray(value) && !value.length) continue;
    if (
      [
        "sniff",
        "sniff_override_destination",
        "set_system_proxy",
        "tcp_fast_open",
        "tcp_multi_path",
        "udp_fragment",
      ].includes(key) &&
      value === false
    )
      continue;
    if (key === "domain_strategy" && value === "") continue;
    throw issue("INBOUND_OPTIONS");
  }
  const hosts =
    listen === "127.0.0.1" || listen === "localhost"
      ? ["127.0.0.1", "localhost"]
      : [listen === "::1" ? "[::1]" : listen];
  const protocols = [];
  if (inbound.type !== "http") protocols.push("socks5", "socks", "socks5h");
  if (inbound.type !== "socks") protocols.push("http");
  return {
    listen,
    port,
    proxyUrls: hosts.flatMap((host) =>
      protocols.map((protocol) => `${protocol}://${host}:${port}`),
    ),
  };
}

/**
 * Analyze an in-memory full sing-box configuration without I/O or logging.
 * Candidates contain credentials and MUST stay inside the trusted main process.
 * Only counts and fixed-code diagnostics are suitable for migration logs.
 * All valid nodes are candidates, even if no inbound uses them; mappings point
 * to a single candidate per target tag. Real sing-box check remains mandatory.
 */
export function analyzeSingboxMigration(input) {
  const result = { candidates: [], mappings: [], skipped: [], warnings: [] };
  let source;
  try {
    const serialized = JSON.stringify(input);
    if (!serialized || Buffer.byteLength(serialized) > 8 * 1024 * 1024)
      throw new Error();
    source = JSON.parse(serialized);
    if (
      !isObject(source) ||
      !Array.isArray(source.outbounds ?? []) ||
      !Array.isArray(source.endpoints ?? []) ||
      !Array.isArray(source.inbounds ?? []) ||
      !isObject(source.route ?? {}) ||
      !Array.isArray(source.route?.rules ?? []) ||
      (source.dns !== undefined && !isObject(source.dns))
    )
      throw new Error();
  } catch {
    result.skipped.push(issue("INVALID_CONFIG"));
    return result;
  }
  const route = source.route ?? {};
  if (
    Object.keys(route).some(
      (key) => !["rules", "final", "default_domain_resolver"].includes(key),
    )
  ) {
    result.skipped.push(issue("UNSUPPORTED_ROUTE_OPTIONS"));
    return result;
  }
  if (hasInboundCondition(source.dns)) {
    result.skipped.push(issue("DNS_INBOUND_RULES"));
    return result;
  }
  if (source.experimental) result.warnings.push(issue("RUNTIME_STATE"));
  if (source.dns?.servers?.some?.((server) => server?.address !== undefined))
    result.warnings.push(issue("LEGACY_DNS"));

  const entries = [
    ...(source.outbounds ?? []).map((node, sourceOutboundIndex) => ({
      node,
      location: { sourceOutboundIndex },
      kind: "outbounds",
    })),
    ...(source.endpoints ?? []).map((node, sourceEndpointIndex) => ({
      node,
      location: { sourceEndpointIndex },
      kind: "endpoints",
    })),
  ];
  const byTag = new Map();
  for (const entry of entries) {
    const tag = entry.node?.tag;
    if (typeof tag === "string" && tag) {
      const matching = byTag.get(tag) ?? [];
      matching.push(entry);
      byTag.set(tag, matching);
    }
  }
  const dnsReferences = [];
  dnsDetours(source.dns, dnsReferences);
  const candidateIndexes = new Map();
  for (const entry of entries) {
    const { node, location } = entry;
    try {
      if (
        !isObject(node) ||
        typeof node.type !== "string" ||
        typeof node.tag !== "string" ||
        !node.tag
      )
        throw issue("INVALID_NODE");
      if (byTag.get(node.tag).length !== 1) throw issue("DUPLICATE_TAG");
      if (NON_PROXY_TYPES.has(node.type)) throw issue("NON_PROXY");
      const required = new Set();
      const visiting = new Set();
      const visit = (tag) => {
        if (typeof tag !== "string" || !tag) throw issue("INVALID_DEPENDENCY");
        if (visiting.has(tag)) throw issue("CYCLIC_DEPENDENCY");
        if (required.has(tag)) return;
        const matches = byTag.get(tag);
        if (!matches || matches.length !== 1) throw issue("MISSING_DEPENDENCY");
        const dependency = matches[0].node;
        if (NON_PROXY_TYPES.has(dependency.type))
          throw issue("NON_PROXY_DEPENDENCY");
        visiting.add(tag);
        nodeReferences(dependency).forEach(visit);
        visiting.delete(tag);
        required.add(tag);
      };
      visit(node.tag);
      dnsReferences.forEach(visit);
      const dependencies = entries.filter((item) =>
        required.has(item.node?.tag),
      );
      const fragment = {
        outbounds: dependencies
          .filter((item) => item.kind === "outbounds")
          .map((item) => item.node),
        ...(dependencies.some((item) => item.kind === "endpoints")
          ? {
              endpoints: dependencies
                .filter((item) => item.kind === "endpoints")
                .map((item) => item.node),
            }
          : {}),
        ...(source.dns ? { dns: source.dns } : {}),
        route: {
          final: node.tag,
          ...(route.default_domain_resolver !== undefined
            ? { default_domain_resolver: route.default_domain_resolver }
            : {}),
        },
      };
      let config;
      try {
        config = normalizeProxyConfig(fragment);
      } catch {
        throw issue("INVALID_FRAGMENT");
      }
      candidateIndexes.set(node.tag, result.candidates.length);
      result.candidates.push({
        ...location,
        sourceOutboundTag: node.tag,
        name: node.tag,
        config,
      });
    } catch (error) {
      const code = Object.hasOwn(REASONS, error?.code)
        ? error.code
        : "INVALID_FRAGMENT";
      result.skipped.push(issue(code, location));
    }
  }
  for (const [sourceInboundIndex, inbound] of (
    source.inbounds ?? []
  ).entries()) {
    try {
      const address = inboundAddress(inbound);
      const target = routeTarget(
        inbound.tag,
        route,
        source.outbounds?.[0]?.tag,
      );
      if (!candidateIndexes.has(target)) throw issue("TARGET_UNAVAILABLE");
      result.mappings.push({
        sourceInboundIndex,
        ...address,
        sourceOutboundTag: target,
        candidateIndex: candidateIndexes.get(target),
      });
    } catch (error) {
      const code = Object.hasOwn(REASONS, error?.code)
        ? error.code
        : "INVALID_ROUTE";
      result.skipped.push(issue(code, { sourceInboundIndex }));
    }
  }
  if (result.mappings.length)
    result.warnings.push(issue("MANAGED_HTTP_INBOUND"));
  return result;
}
