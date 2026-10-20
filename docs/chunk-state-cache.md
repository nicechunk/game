# 普通 chunk 账户缓存与显示调度（0.1.96）

## 范围

普通 `chunk-broken`/`chunk-placed` PDA 的 finalized 读取。保留两个独立无损账户组件，包括被 Placed 覆盖的 Broken 坐标、Placed volume、完整分配空间、owner/executable 与布局描述。组件 SHA-256 和 pair token 不包含观察时间或 slot；渲染投影另行去重。它们是缓存完整性标识，不能证明链上最新状态。

不改合约、PDA、租金、交易权限、confirmed 交易预检或 pending/confirmed 保护层。天然装饰拾取的 surface-picked 账户仍由原有同步路径处理。

## 请求与水位

- 每批最多 100 账户 / 50 对；全局当前同步池最多 4 个并发批次。
- 冷近场使用最多 8 对的小批，背景和 warm 批最多 50 对。冷读可能增加请求数，目标是提前交付近场结果。
- 完整基底存在时，条件阈值取批内各 pair `knownAtSlot` 的最小值，inclusive；`minContextSlot` 独立保持所需最低水位。绝不把全局最新 slot 当作所有 pair 的条件阈值。
- 捕获不可变的两侧组件与 token。full/unchanged/null 混合后验证完整 pair，再原子发布内存和该 pair 水位。错误保留旧显示，只修复对应 pair。
- 严格 null 才是 absent。明确、无矛盾的 `{status:"unchanged"}` 才能复用捕获基底。先前 absent 却收到 unchanged 会定向全量修复。
- 有效 context、数组长度、JSON-RPC id、账户顺序、owner、executable、布局、容量、坐标、重复记录、volume 和编码均检查。
- 双 unchanged 不重新解码、计算正文摘要、排序、规范化、重建或上传；仍检查显示是否需要恢复。

## Endpoint 能力与配置

默认编码为 base64。`changedSinceSlot` 按 endpoint/config epoch 探测，只有实际 unchanged 才确认支持。忽略参数返回 full 的 RPC 直接消费本次结果；明确不支持时有界回退。429/超时不视为不支持；429/服务端错误按全局退避，其余账户错误按 pair 使用 1–15 秒退避，提示事件可精确失效。

可选 Zstd：在现有客户端配置存储设置 `nicechunk.chunkRpcEncoding = "base64+zstd"`，刷新后启用；移除此项恢复默认。不改变 RPC URL/API key 来源。生产主线程 fallback 继续用 base64，压缩在 PDA Worker 中解码。只有 full 账户加载解码器；unchanged/null 不加载。输出最多 18,448 B，独立窗口上限 8 MiB，输入和 block/frame 数量有界，禁止截断/拼接帧。实际 public RPC 的小账户也可能声明 2 MiB 窗口。fzstd 0.1.1 的原始 MIT 许可保存在 `play/vendor/fzstd.LICENSE` 并随 runtime 分发。

Zstd 与 conditional 能力独立管理；无效压缩数据保持旧世界，定向修复使用 base64。压缩与条件读取都不自动降低 RPC 次数、费用或 PDA 成本。

## 持久缓存、迁移与内存

IndexedDB 保留原 snapshots store，并升级到 DB v2，新增 `account-pairs` store。每个记录一次事务存储两侧组件、投影、token 和水位。事务或 quota 失败不撤销已验证内存内容。未变 metadata 至多每 30 秒持久更新，同 key 写入合并；后台写入队列也有数量和 bytes 上限。

pair 内存和 Worker 缓存各最多 2,048 项 / 64 MiB 准入计费；持久缓存最多两倍。TypedArray bytes 精确计数，JS 记录与对象使用保守计费，非浏览器实际 heap 测量。LRU 和在途捕获引用分开；逐出不破坏已经捕获的基底。跨 Worker 只转移新建的紧凑投影副本，缓存唯一 raw buffer 不 transfer。Worker 失去 token 时一次 full 冷读恢复，不拼接未知组件。

scope 包含实测 genesis、program、globalConfig、派生 seeds、账户格式、世界/生成规则/尺寸。相同链更换 provider 不混用迟到请求。真实 chain identity 验证可增加首次启动的一次 bootstrap 读取。慢 IDB 不阻塞必要近场 RPC；因此冷启动时磁盘恢复和 full 读取可能并行。

旧 v2 合并快照不能充当增量基底。已核对 0.1.95 固定 Devnet genesis/program/global PDA/seeds 的旧 namespace 可作预览，再以 full pair 惰性升级；无法确认 namespace 的旧记录保留但不展示。

## 显示、事件与预算

兴趣变化立即恢复内存/异步磁盘并调度读取。正常移动不会撤销交叠区域请求；权威/endpoint 切换仍取消旧 epoch。Guardian/本地操作仅提供精确失效提示，不能刷新权威观察时间。现有近/中/远 finalized 复验窗口保持 15/45/120 秒；页面恢复、重连触发补读。无新增全世界扫描或无限账户订阅。

host 每帧只给一个轮转阶段预留至多 0.8ms：快照、建筑、网格、上传各获得服务。保留共享软预算，低层收到过期 deadline 仍不工作。真实 GPU 等待/context lost 单独记录；不使用 gl.finish。不可分割的单次提交仍可能超出软 slice，真实设备 p95/p99 需要另验。

Worker terminal 和预期包收齐并校验后释放计算槽；发布队列仍按 revision/顺序消费。24 个 ready job 或 64 MiB 排队几何触发调度回压，已经计算中的有限任务可在其后完成。计算失败不能丢弃同 Worker 先前已完成的待发布几何。

常见不透明普通方块可使用有界、完整材质的小网格反馈：最多 32 个 action / 64 个 CPU 模型；正式 section 匹配 revision 的 GPU handle 就绪后交接。旧 action 回滚不删除后来 action；不透明洞穴移除及邻接面仍由 section mesher 正确重建。复杂/透明资源和仙人掌继续使用完整原有模型路径，不能用通用方块占位。该快路径保留 staging/fence/context 校验，不承诺软件 GPU 下 1–2 帧达标。

`presentationRequest.firstDrawSubmitted` 只在实际绘制目标 revision 的几何后记录，包含 pairValidated→firstDraw 和 interestEnter→firstDraw。它是 GPU draw submission，屏幕呈现及认证实机体验需另验。

## 回归与重跑

- `npm run check`：游戏全套（完整 Guardian companion 检查需设置现有两个二进制环境变量）。
- `cd chunk.js && npm run check`：引擎全套与浏览器产物检查。
- 新专项：`chunk-incremental-pairs.test.mjs`、`chunk-service-progress.test.mjs`、`chunk-incremental-browser.test.mjs`。
- 浏览器专项使用 `NICECHUNK_TEST_SOFTWARE_GL=1 node --import ./scripts/test-browser-setup.mjs --test --test-concurrency=1 play/tests/chunk-incremental-browser.test.mjs`。可用 `NICECHUNK_INCREMENTAL_EVIDENCE` 指定结果目录。
- 工作区交付脚本另含真实有限只读样本、ABBA 成对账户回放、实际发布 Worker 和公开文件哈希核验；测试桩、软件 GL 和真实网络数据分开报告。

可选共享 hash/ETag 服务未启用；A/B 路径独立工作，不依赖 Guardian 改造或新合约。
