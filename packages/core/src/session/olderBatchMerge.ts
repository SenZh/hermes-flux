/**
 * 鍘嗗彶娑堟伅鎵规鍚戜笂鎷兼帴涓庡畨鍏ㄥ悎骞剁函鍑芥暟 (packages/core/src/session/olderBatchMerge.ts)
 *
 * 銆愯璁℃剰鍥?(Why)銆?
 *   鍚戞棭缈婚〉锛圥repend锛夋媺鍙栧洖鏉ョ殑鎵规涓烘洿鏃╃殑鍘嗗彶琛岋紝涓ョ浣跨敤姝ｅ悜杩藉姞鐨?planSessionLoadMerge锛?
 *   鍚﹀垯鍦ㄦ壒娆¤緝鐭笖鏃犻噸鍙犳椂浼氳鍒ゅ畾涓轰笉鍚屾簮鑰岀洿鎺ヤ涪寮冦€?
 *   蹇呴』涓撹绾嚱鏁板鐞嗗ご閮ㄦ嫾鎺ャ€侀噸鍙犲幓閲嶄笌鏃堕棿绾垮崟璋冩€с€?
 *
 * 銆愰槻鑼冪殑鍘嗗彶鍧?(Pitfall)銆?
 *   1. planSessionLoadMerge 鐭矾鍒嗘敮灏嗘棤閲嶅彔鏇存棭鍘嗗彶 100% 涓㈠純锛?
 *   2. 鏈烘 [...batch, ...existing] 鍦ㄥ垎椤甸噸鍙犳椂瀵艰嚧鍚屼竴鏉℃秷鎭噸澶嶆覆鏌撲袱浠斤紱
 *   3. 涓存椂鏃?rowId 娑堟伅琚敊璇彃鍒板ご閮ㄧ牬鍧忓垪琛ㄩ『搴忋€?
 *
 * 銆愮害鏉熶笌瑙勫垯 (Rules)銆?
 *   - 绾嚱鏁帮紝闆?IO锛岃緭鍏ヤ笉鍙彉锛?
 *   - 浠?rowId 鎴?id 浣滀负鍞竴鍘婚噸渚濇嵁锛?
 *   - 淇濇寔鎸佷箙琛岄€掑鍏ㄥ簭銆?
 */

export interface MinimalIdentifiedMessage {
  id: string;
  sessionId?: string;
  rowId?: number;
  rawTimestamp?: number;
  timestamp?: string | number;
}

/**
 * 鏈湴宸茶鐩栬鏁颁笅鐣屻€?
 *
 * 銆愯璁℃剰鍥?(Why)銆?
 *   缃戝叧 `/messages` 鐨?offset 鏄€屼粠鏈€鏂扮璺宠繃鐨勬寔涔呰鏁般€嶏紝鑰屾湰鍦板垪琛ㄦ槸瑙嗗浘娑堟伅
 *   锛堝伐鍏疯琚惛鏀躲€侀殣钘忚琚繃婊わ級锛屾潯鏁板彧浼氬皯浜庤鏁般€傜敤瑙嗗浘鏉℃暟浣滀笅鐣岋紝
 *   淇濊瘉缈婚〉璧风偣涓€瀹氳惤鍦ㄦ湰鍦板凡瑕嗙洊鍖洪棿鍐咃紝缁濅笉璺宠繃鏈姞杞界殑鐪熷疄鍘嗗彶銆?
 * 銆愮害鏉熶笌瑙勫垯 (Rules)銆戝彧缁熻鏈夋寔涔?rowId 鐨勮锛涘甫 sessionId 涓斾笉灞炰簬褰撳墠浼氳瘽鐨勮
 *   锛堢埗浼氳瘽琛€缂橈級涓嶈鍏ャ€傜己 sessionId 鐨勭紦瀛樻仮澶嶈鎸夎鍏ュ鐞嗏€斺€斿畠鍙兘楂樹及锛?
 *   鐢辩炕椤典晶鐨勪竴娆℃€?楂樹及鍥為€€"鍏滃簳锛岀粷涓嶅洜姝ゆ妸鏈嶅姟绔粛鏈夌殑涓€鏁存鍘嗗彶鍒ゆ垚宸插埌鏈€鏃┿€?
 */
export function countLocalCoveredRows(
  messages: readonly MinimalIdentifiedMessage[] | null | undefined,
  sessionId?: string
): number {
  if (!Array.isArray(messages)) return 0;
  let covered = 0;
  for (const message of messages) {
    if (typeof message.rowId !== 'number' || !(message.rowId > 0)) continue;
    if (sessionId && message.sessionId && message.sessionId !== sessionId) continue;
    covered += 1;
  }
  return covered;
}

export interface OlderPaginationPlanInput {
  /** 鐜版湁娓告爣锛氬凡纭浠庢渶鏂扮瑕嗙洊鐨勮鏁?*/
  storedOffset: number;
  /** 鏈湴宸茶鐩栬鏁颁笅鐣岋紙countLocalCoveredRows 鐨勭粨鏋滐級 */
  localCoveredRows: number;
  /** 鏈壒缃戝叧杩斿洖琛屾暟锛涗负 0 琛ㄧず鍙眰璇锋眰璧风偣 */
  returned: number;
  /** 鏈壒鎸夌綉鍏冲崌搴忕殑鎸佷箙琛?id */
  batchRowIds: readonly number[];
  /** 鏈湴鏈€鏃╀竴鏉℃寔涔呰 id */
  earliestLocalRowId: number | null;
}

export interface OlderPaginationPlan {
  queryOffset: number;
  nextOffset: number;
}

/**
 * 鍚戞棭缈婚〉鐨勬父鏍囪鍒掋€?
 *
 * 銆愯璁℃剰鍥?(Why)銆?
 *   娓告爣蹇呴』鍚屾椂婊¤冻涓ゆ潯锛氣憼 璇锋眰璧风偣涓嶅皬浜庢湰鍦板凡瑕嗙洊琛屾暟锛屽惁鍒欓噸澶嶆媺鍙栦笖姣忔
 *   鍙帹杩涗竴閮ㄥ垎锛岀己鍙ｇ疮绉悗鐩存帴璺宠繃鏁存鍘嗗彶锛涒憽 鎵规鍛戒腑鏈湴鏈€鏃╄鏃舵寜璇ヨ鐨?
 *   绮剧‘浣嶇疆鏀舵暃锛岄伩鍏嶆瘡杞兘浠庡ご閲嶅彔銆?
 * 銆愰槻鑼冪殑鍘嗗彶鍧?(Pitfall)銆?
 *   棣栧睆 REST 鍙洖 100 琛岃€屽悎骞朵繚鐣欎簡鏈湴 1130 鏉¤鍥炬椂锛屾棫浠ｇ爜鎶婃父鏍囪鎴?100锛?
 *   涔嬪悗姣忚疆 `offset += returned(500)`锛屾父鏍囧緢蹇秺杩囨湰鍦扮湡瀹炶鐩栬竟鐣岋紝
 *   涓€斾竴鏁存鍘嗗彶姘歌繙涓嶅啀鍔犺浇锛屾渶缁?`returned = 0` 琚鍒や负銆屽凡鍒版渶鏃┿€嶃€?
 * 銆愮害鏉熶笌瑙勫垯 (Rules)銆?
 *   1. 绾嚱鏁般€侀浂 IO锛?
 *   2. `nextOffset` 鍗曡皟涓嶅噺锛屼笖涓嶈秴杩?`queryOffset + returned`锛?
 *   3. 鍛戒腑鏈湴鏈€鏃╄鏃跺彇銆屼繚瀹堟粸鍚庛€嶈竟鐣岋細瀹佸彲澶氭媺涓€杞噸鍙狅紝涔熶笉璺宠繃璇ヨ涔嬪墠灏氭湭钀藉湴鐨勮锛?
 *   4. 鏃犳硶瀹氫綅鏈湴鏈€鏃╄鏃舵寜 `returned` 鎺ㄨ繘锛屼笌缃戝叧鍒嗛〉璇箟涓€鑷淬€?
 */
export function planOlderPagination(input: OlderPaginationPlanInput): OlderPaginationPlan {
  const storedOffset = Number.isFinite(input.storedOffset) && input.storedOffset > 0
    ? Math.floor(input.storedOffset)
    : 0;
  const localCoveredRows = Number.isFinite(input.localCoveredRows) && input.localCoveredRows > 0
    ? Math.floor(input.localCoveredRows)
    : 0;
  const queryOffset = Math.max(storedOffset, localCoveredRows);
  const returned = Number.isFinite(input.returned) && input.returned > 0 ? Math.floor(input.returned) : 0;

  let nextOffset = queryOffset + returned;
  const earliest = input.earliestLocalRowId;
  if (typeof earliest === 'number' && earliest > 0) {
    const indexInBatch = input.batchRowIds.findIndex((id) => id === earliest);
    if (indexInBatch >= 0) nextOffset = queryOffset + indexInBatch + 1;
  }
  // 涓婄晫纭害鏉燂細鏃犺鎵瑰唴涓嬫爣濡備綍锛屽崟杞帹杩涢兘涓嶅緱瓒呰繃鏈壒瀹為檯杩斿洖鐨勮鏁般€?
  return { queryOffset, nextOffset: Math.max(queryOffset, Math.min(nextOffset, queryOffset + returned)) };
}

export interface OlderBatchMergeOptions {
  /**
   * 鎵规鎵€灞炰細璇?id銆?
   *
   * 銆愯璁℃剰鍥?(Why)銆戝垪琛ㄥご閮ㄥ彲鑳藉凡缁忔槸鏇存棭鐨勭埗浼氳瘽琛€缂樿锛涜嫢鐢ㄣ€岀涓€鏉℃湁 rowId 鐨勮銆?
   *   褰撻敋鐐癸紝閿氱偣浼氳鐖惰澶鸿蛋锛屾湰浼氳瘽鏇存櫄鐨勮灏变細琚暣鎵瑰鍒扮埗鍘嗗彶涔嬪墠銆?
   * 銆愮害鏉熶笌瑙勫垯 (Rules)銆戞彁渚涜 id 鏃讹紝閿氱偣涓庢彃鍏ョ偣閮藉彧鎸夎浼氳瘽鐨勮鍒ゅ畾锛?
   *   缂虹渷淇濇寔鏃ц涓猴紝渚涙棦鏈夎皟鐢ㄦ柟鍏煎銆?
   */
  timelineSessionId?: string;
  /**
   * 缂哄け sessionId 鐨勮鐨勫綊灞炰細璇濓紙閫氬父鏄綋鍓嶅彾瀛愪細璇濓級銆?
   *
   * 銆愯璁℃剰鍥?(Why)銆戞寔涔呯紦瀛樻仮澶嶅嚭鏉ョ殑琛屼笉甯?sessionId锛涙妸瀹冧滑褰撴垚銆屽睘浜庝换浣曟椂闂寸嚎銆?
   *   浼氳鐖朵細璇濇壒娆℃壘鍒伴敊璇彃鍏ョ偣锛屼篃浼氳鏈細璇濇壒娆¤閿欓敋鐐广€?
   */
  fallbackSessionId?: string;
}

export interface OlderBatchMergeResult<T> {
  merged: T[];
  /**
   * 琚€屾洿鏃╄竟鐣屻€嶄涪寮冪殑琛屾暟銆?
   *
   * 銆愯璁℃剰鍥?(Why)銆戣皟鐢ㄦ柟蹇呴』鑳藉尯鍒嗕袱绉嶃€屽噣澧炰负 0銆嶏細鏁存壒閮芥槸宸叉寔鏈夌殑閲嶅琛?
   *   锛堝彲浠ユ斁蹇冩帹杩涙父鏍囷級锛屼互鍙婃暣鎵硅杈圭晫杩囨护锛堣鏄庨敋鐐瑰彛寰勪笌鎵规浼氳瘽涓嶄竴鑷达紝
   *   鎺ㄨ繘娓告爣灏辨槸姘镐箙涓㈡帀杩欐鍘嗗彶锛夈€傚彧鍥炰紶鍚堝苟缁撴灉鏃犳硶鍒嗚鲸銆?
   */
  droppedCount: number;
}

export function planOlderBatchPrependMerge<T extends MinimalIdentifiedMessage>(
  olderBatch: readonly T[],
  currentMessages: readonly T[],
  options?: OlderBatchMergeOptions
): T[] {
  return planOlderBatchPrependMergeDetailed(olderBatch, currentMessages, options).merged;
}

/**
 * 涓?`planOlderBatchPrependMerge` 鍚屾簮锛岄澶栧洖浼犺涓㈠純琛屾暟銆?
 *
 * 銆愮害鏉熶笌瑙勫垯 (Rules)銆戠函鍑芥暟銆侀浂 IO锛屼袱澶勫鍑哄叡鐢ㄥ悓涓€浠藉疄鐜帮紝绂佹鍚勫啓涓€濂楄竟鐣屽垽瀹氥€?
 */
export function planOlderBatchPrependMergeDetailed<T extends MinimalIdentifiedMessage>(
  olderBatch: readonly T[],
  currentMessages: readonly T[],
  options?: OlderBatchMergeOptions
): OlderBatchMergeResult<T> {
  if (!olderBatch || olderBatch.length === 0) {
    return { merged: currentMessages ? [...currentMessages] : [], droppedCount: 0 };
  }
  if (!currentMessages || currentMessages.length === 0) {
    return { merged: [...olderBatch], droppedCount: 0 };
  }

  const timelineId = options?.timelineSessionId;
  const fallbackId = options?.fallbackSessionId;
  const belongsToTimeline = (m: T): boolean =>
    Boolean(timelineId) && (m.sessionId ?? fallbackId) === timelineId;

  // 纭繚 olderBatch 鑷韩鏄寜鏃堕棿/琛屽彿鍗囧簭鎺掑垪锛堥槻寰＄綉鍏?order=latest 杩斿洖浠庢柊鍒版棫鐨?DESC 搴忓垪锛?
  const normalizedOlder = [...olderBatch].sort((a, b) => {
    const ta = typeof a.rawTimestamp === 'number' ? a.rawTimestamp : 0;
    const tb = typeof b.rawTimestamp === 'number' ? b.rawTimestamp : 0;
    if (ta && tb && ta !== tb) return ta - tb;
    const ra = typeof a.rowId === 'number' && a.rowId > 0 ? a.rowId : 0;
    const rb = typeof b.rowId === 'number' && b.rowId > 0 ? b.rowId : 0;
    return ra - rb;
  });

  // 鏋勯€犲鍚堝敮涓€鍘婚噸閿細(sessionId, rowId) 澶嶅悎閿紭鍏堬紝褰诲簳鏉滅粷鐖跺瓙浼氳瘽灞€閮?rowId 纰版挒
  const compositeKey = (m: T): string => {
    const sess = m.sessionId || fallbackId || '';
    if (typeof m.rowId === 'number' && m.rowId > 0) {
      return sess ? `${sess}::row::${m.rowId}` : `row::${m.rowId}`;
    }
    return sess ? `${sess}::id::${m.id}` : `id::${m.id}`;
  };

  const matchKey = (a: T, b: T): boolean => {
    return compositeKey(a) === compositeKey(b);
  };

  /**
   * 鍙帴鍙椼€屼弗鏍兼棭浜庢湰浼氳瘽鍦ㄦ湰鍦扮殑鏈€鏃╂寔涔呰銆嶇殑琛屻€?
   *
   * 銆愰槻鑼冪殑鍘嗗彶鍧?(Pitfall)銆?
   *   娓告爣钀藉悗浜庢湰鍦板凡瑕嗙洊琛屾暟鏃讹紝缃戝叧鎵规浼氬悓鏃跺寘鍚洿鏃╄銆佸凡鎸佹湁琛屽拰姣旀湰鍦版渶鏃╄
   *   鏇存櫄鐨勮銆傛棫瀹炵幇鎶婃墍鏈夈€屼笉鍦ㄥ綋鍓嶉泦鍚堛€嶇殑琛屼竴寰嬪ご鎻掞紝绛変簬鎶婃洿鏅氱殑琛屾惉鍒板垪琛?
   *   鏈€鍓嶉潰锛氶琛?rowId 鍙嶈€屽彉澶с€佹椂闂寸嚎鍊掓寕銆傚畞鍙涪寮冩棤娉曡瘉鏄庢洿鏃╃殑琛岋紙涓嬭疆杩樿兘
   *   閲嶆柊鎷夊埌锛夛紝涔熺粷涓嶅厑璁稿垪琛ㄥけ搴忋€?
   * 銆愮害鏉熶笌瑙勫垯 (Rules)銆?
   *   1. 鎻愪緵 `timelineSessionId` 鏃讹紝閿氱偣涓ユ牸闄愬畾鍦ㄨ浼氳瘽鐨勮鍐咃紱鏈細璇濆湪鏈湴灏氭棤浠讳綍琛?
   *      锛堥娆＄炕鐖朵細璇濇锛夋椂閿氱偣涓?undefined锛屾暣鎵规斁琛?鈥斺€?璺ㄤ細璇?rowId 绌洪棿鏃犲叧锛?
   *      鎷垮埆鐨勪細璇濋琛屽綋閿氱偣浼氭妸鏁存壒鐖朵細璇濆巻鍙插垹鍏夛紱
   *   2. 璺ㄤ細璇濓紙鐖朵細璇濊缂橈級琛屼笉鍙備笌 rowId 杈圭晫姣旇緝锛岀户缁寜鏃堕棿绾垮墠缃€?
   */
  const anchor = timelineId
    ? currentMessages.find((m) => belongsToTimeline(m) && typeof m.rowId === 'number' && m.rowId > 0)
    : currentMessages.find((m) => typeof m.rowId === 'number' && m.rowId > 0);
  /**
   * 无共享行时的方向判定。
   *
   * 【设计意图 (Why)】
   *   网关的物理 id 不单调于显示序（官方 session_stored_reads.py:179 明文承认），
   *   所以「id 更小」既不是「更早」的必要条件也不是充分条件。
   *   无共享行时唯一可用的方向证据是时间戳：本行时间严格早于本地最早行即为更早。
   *   时间戳只用于方向判定，绝不用于列表排序（排序始终是服务端返回顺序）。
   *
   * 【防范的历史坑 (Pitfall)】
   *   1. 只用 id 比较：会话 20261020_150348_4fe41e 实测丢首问 18541（id 更大但时间更早）；
   *   2. 完全不做方向判定就前插：older-batch-regression 记录的真实事故会把更晚的行搬到列表最前。
   *   两条都必须挡住，故用「id 更小 OR 时间更早」双证据，都不成立才按更晚处理。
   *
   * 【约束与规则 (Rules)】跨会话（父会话血缘）行不参与本会话边界比较，继续按时间线前置。
   */
  const strictlyEarlier = (m: T): boolean => {
    if (!anchor || typeof anchor.rowId !== 'number') return true;
    if (typeof m.rowId !== 'number' || !(m.rowId > 0)) return true;
    const sameTimeline = timelineId
      ? belongsToTimeline(m)
      : !m.sessionId || !anchor.sessionId || m.sessionId === anchor.sessionId;
    if (!sameTimeline) return true;
    if (m.rowId < anchor.rowId) return true;
    const rowTs = typeof m.rawTimestamp === 'number' ? m.rawTimestamp : undefined;
    const anchorTs = typeof anchor.rawTimestamp === 'number' ? anchor.rawTimestamp : undefined;
    if (typeof rowTs === 'number' && typeof anchorTs === 'number') return rowTs < anchorTs;
    return false;
  };
  const boundedOlder = normalizedOlder.filter(strictlyEarlier);
  /**
   * 被「更早边界」丢掉、且本地确实没有的行数。
   *
   * 【设计意图 (Why)】上层要区分两种「净增为 0」：整批都是本地已持有的重复行
   *   （游标可以放心推进），与整批被方向过滤掉且本地从未有过（推进游标就是永久丢历史）。
   *   直接把过滤条数当丢弃数会把重叠批次误报成危险，导致本该推进的游标被卡住。
   */
  const heldKeys = new Set<string>();
  for (const m of currentMessages) heldKeys.add(compositeKey(m));
  const droppedUnseenCount = normalizedOlder.filter(
    (m) => !strictlyEarlier(m) && !heldKeys.has(compositeKey(m))
  ).length;

  /**
   * 鎵规鎻掑叆鐐癸細璺宠繃鍒楄〃澶撮儴鏇存棭鐨勭埗浼氳瘽琛€缂樿锛屾彃鍒版湰浼氳瘽绗竴琛屼箣鍓嶃€?
   *
   * 銆愰槻鑼冪殑鍘嗗彶鍧?(Pitfall)銆戞棤鏉′欢 `[...older, ...current]` 浼氭妸鏈細璇濇洿鏃╃殑鎵规
   *   濉炲埌鐖朵細璇濆巻鍙蹭箣鍓嶏紝鍐峰惎鍔ㄥ悗 exhausted 鏍囪娓呴浂鏃朵細鐪熷疄鍙戠敓銆?
   */
  const insertionIndex = (() => {
    if (!timelineId) return 0;
    const index = currentMessages.findIndex((m) => belongsToTimeline(m));
    return index >= 0 ? index : 0;
  })();
  const spliceOlder = (older: readonly T[]): T[] => [
    ...currentMessages.slice(0, insertionIndex),
    ...older,
    ...currentMessages.slice(insertionIndex),
  ];

  // 1. 鏌ユ壘鏄惁瀛樺湪閲嶅彔娑堟伅
  // 浠?currentMessages 澶撮儴鍙栫涓€鏉℃秷鎭紝鐪嬫槸鍚﹀湪 boundedOlder 涓瓨鍦?
  const firstCurrent = currentMessages[0];
  const overlapIdxInOlder = boundedOlder.findIndex((m) => matchKey(m, firstCurrent));

  if (overlapIdxInOlder >= 0) {
    // boundedOlder 鐨?[0, overlapIdxInOlder) 鏄函鏇存棭鐨勬秷鎭?
    const pureOlderHead = boundedOlder.slice(0, overlapIdxInOlder);
    return { merged: spliceOlder(pureOlderHead), droppedCount: droppedUnseenCount };
  }

  // 2. 濡傛灉绗竴鏉℃湭鍖归厤锛屽叏閲忔壂鎻?boundedOlder 涓槸鍚﹀寘鍚换浣曞凡瀛樺湪鐨勬秷鎭?

  const currentKeySet = new Set<string>();
  for (const m of currentMessages) {
    currentKeySet.add(compositeKey(m));
  }
  const deduplicatedOlder: T[] = [];
  for (const m of boundedOlder) {
    if (!currentKeySet.has(compositeKey(m))) {
      deduplicatedOlder.push(m);
    }
  }

  return { merged: spliceOlder(deduplicatedOlder), droppedCount: droppedUnseenCount };
}
