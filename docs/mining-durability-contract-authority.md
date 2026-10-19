# 挖掘耐久与工具认证（取消默认铁镐）

> 0.1.72 amendment: explicit bare-hand Chunk tags 22/23 allow only natural leaves and surface pebbles/gravel. These do not refer to a default tool and do not debit equipment. All tool-assisted paths retain the fixed three-point contract debit. See [starter tools](starter-tools.md).

## 状态

**已部署 Devnet，网页版本 0.1.71。** Player 升级 slot 为 `512675804`，Chunk 为 `512676412`；公网运行包为 `play-bundle-3cbb2d0ec98b270b`。两个程序均完成 finalized 字节、权限和缓冲区关闭核验；50 个公网文件哈希一致。没有广播玩家采集交易。

## 新流程

1. 前两次有效碰撞只更新本地挖掘进度、动画和裂纹；不改装备耐久。
2. 第三次碰撞提交挖掘请求，只携带工具槽位，不携带扣除量、剩余耐久或本地累计损耗。
3. Chunk 通过受认证的挖掘进度 PDA 调用 Player。Player 从权威账户读取耐久，**固定扣 3 点**；不足 3 点拒绝操作。
4. 扣耐久、修改方块、发放资源和相关进度处于同一交易中，任何一步失败都会整体回滚。取消、失败及重复挖掘已经采下的方块不会扣耐久。
5. 成功后，合约返回工具身份、当前耐久、最大耐久和更新 slot。客户端使用回执或确认后的账户快照更新显示，不做减法或退款加法。

树木连带采集和支撑坍塌以一次主挖掘操作结算 3 点。坍塌后续指令必须通过 Instructions sysvar 证明同一交易中存在同一玩家、同一 actionId 的已付费操作及相邻连接关系，不能单独提交免费采集。普通、玩家放置方块、树木、调试批量和调试范围入口均接入强制结算；旧的无奖励 tag 5 入口已停用。

## 权威状态与接口

### 已取消默认铁镐

- 新号、访客、切换钱包、刷新和清缓存均不赠送工具；空快捷栏仅保留原有背包入口。
- 清理旧本地快捷栏里的合成赠品 `iron_pickaxe`，不补回；真实锻造物品仍以 `forged_item` 和链上身份保存，不按外形或材料名称删除。
- Player 和 Chunk 仅接受 `0..8` 的真实 Equipment 槽。旧默认工具编号 `255` 无效，没有默认装备或徒手采集兜底。
- PlayerProfile 账户长度仍为 773 字节。`765..773` 恢复为零初始化的预留区，不再初始化或读取默认工具余额。旧 `DUR1` 字节不再赋予工具资格。
- 移除本地人物、资料页和远端装备消息中的默认铁镐兜底。模型资产仍可供通用图标和真实锻造工具使用，不代表玩家拥有工具。

### 锻造工具

工具继续由 PlayerEquipment 保管。Player 验证装备 PDA、所有者、物品种类、保管标记及实际耐久，从所选槽位扣除固定值；槽位中的真实物品身份由合约读取并返回。磨损后同步更新公开装备身份，客户端不提交耐久改写。

### 请求与回执

- Player 新增内部扣除入口 tag `18`，只接受规范挖掘进度 PDA 的运行时签名；普通签名账户即使 owner 是 Chunk，也无法冒充该 PDA。
- 主挖掘请求增加 **1 字节**工具选择，仅 `0..8` 为有效装备槽。追加 Player 程序和 Equipment 两个账户，PlayerProfile 与 Equipment 状态账户均可写。
- 回执长度为 57 字节：`NCKDUR01`、工具选择、当前耐久、最大耐久、更新 slot、实际物品 PDA。
- 后续技能/位置指令可能覆盖 transaction returnData，因此客户端同时识别运行时生成的对应 Chunk `Program return:` 记录，只处理成功交易及正确程序签发的回执；槽位和非零物品 PDA 必须匹配请求，拒绝旧默认工具回执。
- 回执 RPC 暂不可用时保留待同步状态，不猜测剩余耐久，不把已确认的交易改判失败或自动重发。旧请求/旧刷新结果不能覆盖更新的采集结果；后续读取使用确认 slot 下界。

三次物理挥动仍是客户端交互进度；本次合约保证的是成功采集的固定耐久成本，客户端跳过动画或修改显示值无法省略链上扣除。

## 交易体积

结构坍塌不产生探索或装饰附加掉落，因此不再携带和验证该路径不使用的两张掉落表。其余真实使用掉落表的采集路径保留完整认证。

最大现有三 Chunk、640 块结构坍塌仍为单笔原子交易：**1,206 字节**，包含真实锻造工具、技能基线同步及采后同步，低于 1,232 字节限制。

## 验证结果

| 项目 | 结果 |
|---|---|
| 合约原生单测 | 73 项通过：Chunk 55、Player 17、Game 1 |
| 客户端相关测试 | 65 项通过，包含无默认工具与真实工具的浏览器交互 |
| 额外 WebGL2 渲染回归 | 容器中 SwiftShader/Vulkan 初始化失败，未通过；不计入上述通过数 |
| 完整 SBF 挖掘交易 | 35 个：8 个合法成功、27 个非法/重放正确拒绝 |
| 开启密码学签名验证的接收方攻击 | 2 个正确拒绝，档案不变 |
| 现有放置兼容性 | 12 个完整交易结果符合预期 |
| 程序构建 | 本轮 Player、Chunk 均成功；Game 依赖使用先前只读捕获的 Devnet 二进制 |
| 网页构建与发布 | 链模块和完整 Play runtime 均成功，0.1.71 已发布 |
| 部署后公共 RPC 只读模拟 | 9 个：4 个合法成功、5 个非法正确拒绝；实际装备余额未改变 |

本地完整回放复用先前只读获取的 Devnet 账户和 Game 程序快照，并在 LiteSVM 中设置工具、方块等边界状态；主回放关闭密码学签名验证，两个独立权限攻击用例开启。无默认工具的浏览器测试实际执行模型恢复、手持选择、采集资格与远端消息认证，不依赖 GPU。完整 WebGL2 渲染另有环境阻断记录。

部署后另用**公网下载的新链模块与公共 Devnet RPC**执行 9 次只读模拟，采用实时真实装备：普通与相邻采集各扣 3 点，两次独立采集扣 6 点，调试批量操作扣 3 点；奖励与合约回执均检查。默认编号 255、非法槽号、错误方块、只读装备及旧无扣费入口均拒绝。过期会话只在模拟交易中刷新，`sigVerify:false`，无玩家交易广播；每次模拟后复查真实装备字节未变。

已覆盖：20→17、3→0、耐久 2/0 拒绝、空装备拒绝、所有活跃采集入口拒绝默认工具、旧档案标记不产生工具、缺失/伪造参数、错误装备 PDA/owner、只读装备、会话过期、后续指令失败的原子回滚、新签名重复采集不重复扣费、同 actionId 的两次独立采集仍扣 6 点，以及主挖掘＋跨区块坍塌只扣 3 点。相同物品设计 PDA 的不同装备槽，耐久显示分别同步。

[结构化报告](/workspace/no-default-pickaxe-20261019/report.json) · [完整挖掘回放](/workspace/no-default-pickaxe-20261019/full-mining-replay.json) · [签名权限测试](/workspace/no-default-pickaxe-20261019/signed-authority-tests.json) · [交易大小](/workspace/no-default-pickaxe-20261019/packet-verification.json) · [合约增量补丁](/workspace/no-default-pickaxe-20261019/nicechunk-programs-incremental.patch) · [客户端增量补丁](/workspace/no-default-pickaxe-20261019/game-incremental.patch)

## 部署核验

构建产物、源码快照、网页包及部署记录保存在 `/workspace/no-default-pickaxe-20261019/`。已按 Player → Chunk → 匹配网页完成发布；Game 背包程序没有升级。Player 容量足够，Chunk 扩容 10,240 字节至 383,984 字节。扩容会更新部署 slot，恢复升级前已查询 confirmed/finalized 状态并逐字节确认原代码保持一致，没有重复扩容或重发 Player 升级。

两个程序的有效代码前缀与本地已测 ELF 完全一致，容量余量均为零填充，升级权限未变，上传缓冲区已关闭，临时缓冲区密钥已移除；升级交易均 finalized。网页使用限定范围的运行包安装器发布，另核对 3 个非发布文件哈希保持一致。未执行 Git 提交或推送。

[部署汇总](/workspace/no-default-pickaxe-20261019/deployment/deployment-summary.json) · [公共 RPC 链上代码核验](/workspace/no-default-pickaxe-20261019/deployment/public-chain-verification.json) · [公网网页核验](/workspace/no-default-pickaxe-20261019/deployment/web-release/public-verification.json) · [线上只读采集模拟](/workspace/no-default-pickaxe-20261019/deployment/live-mining-verification.json)
