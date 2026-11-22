import test from "node:test";
import assert from "node:assert/strict";
import { analyzeSingboxMigration } from "../electron/singboxMigration.js";

const proxy = (tag, type = "http", extra = {}) => ({
  type,
  tag,
  server: "proxy.example.invalid",
  server_port: 443,
  password: "synthetic-password",
  ...extra,
});
const inbound = (tag, port, type = "socks", extra = {}) => ({
  type,
  tag,
  listen: "127.0.0.1",
  listen_port: port,
  ...extra,
});

test("九种合成出口全部保留，六个入口按旧版简单规则映射，未引用出口仍可使用", () => {
  const types = [
    "shadowsocks",
    "shadowsocks",
    "shadowsocks",
    "socks",
    "vless",
    "vless",
    "vless",
    "tuic",
    "http",
  ];
  const source = {
    outbounds: types.map((type, index) => proxy(`out-${index}`, type)),
    inbounds: Array.from({ length: 6 }, (_, index) =>
      inbound(`in-${index}`, 20001 + index),
    ),
    route: {
      rules: [
        { inbound: ["not-present"], outbound: "out-8" },
        ...Array.from({ length: 6 }, (_, index) => ({
          inbound: [`in-${index}`],
          outbound: `out-${index}`,
        })),
      ],
    },
  };
  const original = structuredClone(source);
  const result = analyzeSingboxMigration(source);
  assert.equal(result.candidates.length, 9);
  assert.equal(result.mappings.length, 6);
  assert.deepEqual(result.skipped, []);
  assert.equal(result.candidates[8].config.outbounds[0].type, "http");
  assert.equal(
    result.candidates[8].config.outbounds[0].password,
    "synthetic-password",
  );
  assert.equal(result.mappings[2].candidateIndex, 2);
  assert.ok(result.mappings[2].proxyUrls.includes("socks5://127.0.0.1:20003"));
  assert.deepEqual(source, original);
  result.candidates[0].config.outbounds[0].password = "changed-copy";
  assert.deepEqual(source, original);
});

test("多个入口共用一个候选，支持全局默认出口、无路由时首出口及HTTP混合IPv6地址", () => {
  const source = {
    outbounds: [proxy("shared")],
    inbounds: [
      inbound("a", 21001),
      inbound("b", 21002, "http"),
      inbound("c", 21003, "mixed", { listen: "::1" }),
    ],
    route: { final: "shared" },
  };
  const result = analyzeSingboxMigration(source);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.mappings.length, 3);
  assert.deepEqual(
    result.mappings.map((item) => item.candidateIndex),
    [0, 0, 0],
  );
  assert.ok(result.mappings[1].proxyUrls.includes("http://localhost:21002"));
  assert.ok(result.mappings[2].proxyUrls.includes("http://[::1]:21003"));
  assert.ok(result.mappings[2].proxyUrls.includes("socks5://[::1]:21003"));
  delete source.route;
  assert.equal(analyzeSingboxMigration(source).mappings.length, 3);
});

test("递归保留selector、urltest、detour和DNS detour及default resolver", () => {
  const source = {
    outbounds: [
      {
        type: "selector",
        tag: "group",
        outbounds: ["auto", "node"],
        default: "auto",
      },
      { type: "urltest", tag: "auto", outbounds: ["node"] },
      proxy("node", "vless", { detour: "hop" }),
      proxy("hop", "socks"),
      proxy("dns-hop"),
      proxy("unused"),
    ],
    dns: {
      servers: [
        {
          type: "https",
          tag: "resolver",
          server: "1.1.1.1",
          detour: "dns-hop",
        },
      ],
      final: "resolver",
      strategy: "ipv4_only",
    },
    route: {
      default_domain_resolver: { server: "resolver", strategy: "ipv4_only" },
    },
  };
  const result = analyzeSingboxMigration(source);
  const config = result.candidates[0].config;
  assert.deepEqual(
    config.outbounds.map((node) => node.tag),
    ["group", "auto", "node", "hop", "dns-hop"],
  );
  assert.deepEqual(config.dns, source.dns);
  assert.deepEqual(
    config.route.default_domain_resolver,
    source.route.default_domain_resolver,
  );
  assert.equal(config.route.final, "group");
  assert.equal(result.candidates.length, 6);
  assert.deepEqual(result.skipped, []);
});

test("有条件路由只阻止相关入口绑定，不偷偷改用最终出口；先命中无条件规则可安全终止", () => {
  const source = {
    outbounds: [proxy("a"), proxy("b")],
    inbounds: [inbound("conditional", 22001), inbound("safe", 22002)],
    route: {
      rules: [
        {
          inbound: ["conditional"],
          domain_suffix: ["example.invalid"],
          outbound: "a",
        },
        { inbound: ["safe"], action: "route", outbound: "b" },
        { action: "sniff" },
      ],
      final: "a",
    },
  };
  const result = analyzeSingboxMigration(source);
  assert.equal(result.candidates.length, 2);
  assert.equal(result.mappings.length, 1);
  assert.equal(result.mappings[0].sourceInboundIndex, 1);
  assert.equal(result.mappings[0].sourceOutboundTag, "b");
  assert.equal(result.skipped[0].code, "CONDITIONAL_ROUTE");
  for (const rule of [
    {
      type: "logical",
      mode: "or",
      rules: [{ inbound: ["safe"] }],
      outbound: "a",
    },
    { inbound: ["conditional"], invert: true, outbound: "a" },
    { action: "reject" },
  ]) {
    source.route.rules = [rule];
    assert.equal(analyzeSingboxMigration(source).mappings.length, 0);
  }
});

test("直连及其出口组、缺失依赖、循环、重复标签都拒绝，诊断不泄露源字段", () => {
  const marker = "synthetic-sensitive-marker";
  const source = {
    outbounds: [
      { type: "direct", tag: marker },
      { type: "block", tag: "block" },
      { type: "dns", tag: "dns" },
      { type: "selector", tag: "bad-group", outbounds: [marker] },
      proxy("missing", "http", { detour: `${marker}-missing` }),
      proxy("cycle-a", "http", { detour: "cycle-b" }),
      proxy("cycle-b", "http", { detour: "cycle-a" }),
      proxy("duplicate"),
      proxy("duplicate"),
      proxy("safe"),
    ],
    inbounds: [inbound("a", 23001)],
    route: { final: marker },
  };
  const result = analyzeSingboxMigration(source);
  assert.deepEqual(
    result.candidates.map((node) => node.name),
    ["safe"],
  );
  assert.equal(result.mappings.length, 0);
  const codes = result.skipped.map((item) => item.code);
  for (const code of [
    "NON_PROXY",
    "NON_PROXY_DEPENDENCY",
    "MISSING_DEPENDENCY",
    "CYCLIC_DEPENDENCY",
    "DUPLICATE_TAG",
    "TARGET_UNAVAILABLE",
  ])
    assert.ok(codes.includes(code));
  assert.equal(
    JSON.stringify({
      skipped: result.skipped,
      warnings: result.warnings,
    }).includes(marker),
    false,
  );
});

test("入口认证、嗅探、通配监听和无效端口不会被静默删去，代理候选仍保留", () => {
  const result = analyzeSingboxMigration({
    outbounds: [proxy("proxy")],
    inbounds: [
      inbound("a", 24001, "socks", {
        users: [{ username: "demo", password: "synthetic" }],
      }),
      inbound("b", 24002, "http", { sniff: true }),
      inbound("c", 24003, "mixed", { listen: "0.0.0.0" }),
      inbound("d", 0),
      { type: "tun", tag: "tun" },
      inbound("valid", 24005, "socks", { users: [], sniff: false }),
    ],
  });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.mappings.length, 1);
  assert.equal(result.mappings[0].sourceInboundIndex, 5);
  assert.deepEqual(
    result.skipped.map((item) => item.code),
    [
      "INBOUND_OPTIONS",
      "INBOUND_OPTIONS",
      "NON_LOCAL_INBOUND",
      "INVALID_PORT",
      "UNSUPPORTED_INBOUND",
    ],
  );
});

test("端点及依赖可保留；无法保留的全局路由或DNS入口条件安全拒绝", () => {
  const endpoint = {
    type: "wireguard",
    tag: "wg",
    address: ["10.0.0.2/32"],
    private_key: "synthetic",
  };
  const result = analyzeSingboxMigration({
    endpoints: [endpoint],
    inbounds: [inbound("a", 25001)],
    route: { final: "wg" },
  });
  assert.equal(result.candidates[0].sourceEndpointIndex, 0);
  assert.deepEqual(result.candidates[0].config.endpoints, [endpoint]);
  assert.equal(result.mappings.length, 1);
  for (const [extra, expected] of [
    [{ route: { auto_detect_interface: true } }, "UNSUPPORTED_ROUTE_OPTIONS"],
    [
      { dns: { rules: [{ inbound: ["original-inbound"], server: "dns" }] } },
      "DNS_INBOUND_RULES",
    ],
  ]) {
    const rejected = analyzeSingboxMigration({
      outbounds: [proxy("a")],
      ...extra,
    });
    assert.equal(rejected.candidates.length, 0);
    assert.equal(rejected.skipped[0].code, expected);
  }
});

test("非法输入只返回固定诊断，旧DNS配置不丢弃并提示需要核心校验", () => {
  for (const input of [
    null,
    "secret-input",
    { route: { rules: "secret-input" } },
    { outbounds: {} },
  ]) {
    const result = analyzeSingboxMigration(input);
    assert.deepEqual(
      result.skipped.map((item) => item.code),
      ["INVALID_CONFIG"],
    );
    assert.equal(JSON.stringify(result).includes("secret-input"), false);
  }
  const dns = { servers: [{ address: "local", tag: "old-dns" }] };
  const result = analyzeSingboxMigration({
    outbounds: [proxy("a")],
    dns,
    experimental: { cache_file: { enabled: true } },
  });
  assert.deepEqual(result.candidates[0].config.dns, dns);
  assert.deepEqual(
    result.warnings.map((item) => item.code),
    ["RUNTIME_STATE", "LEGACY_DNS"],
  );
});
