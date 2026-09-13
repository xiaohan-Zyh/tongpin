import 'server-only';

/**
 * 观点相似度计算。
 *
 * 方案：中文 bigram 切分 + TF-IDF 加权 + 余弦相似度。
 *
 * 为什么不用 Embedding：黑客松 Demo 需要零外部依赖、可离线运行，且匹配
 * 结果必须可解释——用户要能看到「因为你们都提到了考研、焦虑」。向量模型
 * 虽然能捕捉同义替换，但无法直接给出这种理由，且引入额外服务依赖。
 * 该取舍的代价（无法识别同义词）已在产品说明中如实标注。
 */

/**
 * 停用词。这些词几乎出现在所有观点中，若不剔除会让相似度普遍偏高，
 * 导致「什么都能匹配上」，匹配结果失去意义。
 */
const STOP_WORDS = new Set([
  '的', '了', '和', '是', '就', '都', '而', '及', '与', '着', '或', '也',
  '一个', '没有', '我们', '你们', '他们', '自己', '这个', '那个', '什么',
  '怎么', '这样', '那样', '因为', '所以', '但是', '可是', '如果', '虽然',
  '还是', '不是', '只是', '真的', '很多', '一些', '这些', '那些', '已经',
  '可以', '不会', '不能', '觉得', '认为', '感觉', '时候', '现在', '起来',
  '出来', '有点', '非常', '特别', '比较', '其实', '就是', '也是', '还有',
  '一样', '这种', '那种', '一直', '一下', '知道', '需要', '应该', '可能',
  '有些', '有时', '会想', '好像', '越来', '来越', '最近', '今天', '突然',
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'and', 'or', 'but', 'of',
  'to', 'in', 'on', 'at', 'for', 'with', 'it', 'this', 'that', 'i', 'you',
]);

/**
 * 语气词与虚词单字。
 * bigram 切分会产生大量跨越语义边界的组合（如「的很」「我也」），
 * 这些组合本身没有意义，却会污染「匹配理由」的展示。
 * 只要 bigram 的任一字属于此集合，就将其降级为不可展示。
 */
const WEAK_CHARS = new Set([
  '的', '了', '很', '我', '你', '他', '她', '它', '也', '都', '就', '而',
  '在', '是', '有', '着', '过', '被', '把', '让', '给', '对', '与', '及',
  '之', '其', '此', '该', '并', '且', '还', '又', '再', '更', '最', '太',
  '好', '不', '没', '要', '会', '能', '可', '得', '地', '着', '吗', '呢',
  '吧', '啊', '哦', '嗯', '这', '那', '些', '个', '种', '样', '么', '上',
  '下', '中', '里', '外', '前', '后', '来', '去', '到', '从', '向', '于',
]);

/** 判断一个词元是否适合作为「匹配理由」展示给用户 */
function isMeaningful(term: string): boolean {
  // 概念标签始终可展示（形如 #独处偏好）
  if (term.startsWith(CONCEPT_PREFIX)) return true;

  // 英文词直接可用
  if (/^[a-z0-9]+$/.test(term)) return term.length > 1;

  // 中文 bigram：任一字为虚词则不展示
  if (term.length !== 2) return false;
  return !WEAK_CHARS.has(term[0]) && !WEAK_CHARS.has(term[1]);
}

/** 概念标签前缀，用于与普通词元区分 */
const CONCEPT_PREFIX = '#';

/**
 * 同义概念词典：把不同表述归一到同一个概念标签。
 *
 * 解决的问题：纯 bigram 是词面匹配，「不想参加饭局」和「很怕热闹的场合」
 * 表达同一态度却没有任何共同词元，相似度会接近 0，明显同频的观点被漏掉。
 * 这里为高频生活议题建立概念映射，作为词面匹配之上的一层轻量语义补充。
 *
 * 边界：词典是人工维护的有限集合，只覆盖常见议题；未覆盖的同义表达
 * 仍依赖词面匹配。这一取舍已在产品说明中标注。
 */
const CONCEPT_LEXICON: Array<{ concept: string; patterns: RegExp }> = [
  {
    concept: '独处偏好',
    patterns:
      /不想参加|不想去|怕热闹|热闹的场合|人多|饭局|聚会|social|应酬|social|一个人待|独处|安静|宁愿一个人/,
  },
  {
    concept: '深度交流',
    patterns:
      /真心话|说真话|说心里话|深入聊|好好聊|慢慢聊|不痛不痒|表面|敷衍|真诚|走心/,
  },
  {
    concept: '升学压力',
    patterns: /考研|二战|考公|保研|复习|图书馆|上岸|分数线|复试|初试/,
  },
  {
    concept: '焦虑情绪',
    patterns:
      /焦虑|睡不着|失眠|没底|恐惧|担心|害怕|压力大|喘不过气|煎熬|崩溃|内耗/,
  },
  {
    concept: '去留抉择',
    patterns:
      /回老家|留在大城市|留下来|北上广|一线城市|小城市|回去|去留|漂着/,
  },
  {
    concept: '生活成本',
    patterns: /房租|工资|通勤|生活成本|物价|存不下|月光|开销/,
  },
  {
    concept: '选择困难',
    patterns: /纠结|两难|难以抉择|不知道该|怎么选|犹豫|摇摆|放弃另一/,
  },
  {
    concept: '职业心态',
    patterns: /加班|工作\d*年|职场|升职|跳槽|证明自己|按时下班|事业/,
  },
  {
    concept: '怀旧感受',
    patterns: /小时候|外婆|奶奶|童年|很多年前|想起|回忆|从前|以前的/,
  },
];

/** 从文本中抽取概念标签 */
function extractConcepts(text: string): string[] {
  const concepts: string[] = [];
  for (const { concept, patterns } of CONCEPT_LEXICON) {
    if (patterns.test(text)) concepts.push(`${CONCEPT_PREFIX}${concept}`);
  }
  return concepts;
}

/**
 * 轻量分词。
 *
 * 中文无空格分隔，采用二元组切分：「记录生活」→「记录」「录生」「生活」。
 * bigram 能在无词典前提下较好捕捉中文语义单元；英文与数字按正常边界切分。
 *
 * 此外会追加概念标签（见 CONCEPT_LEXICON），让语义相近但用词不同的
 * 观点也能匹配上。概念标签重复 CONCEPT_WEIGHT 次以提高其权重——
 * 命中同一概念比命中零散字词更能说明「同频」。
 */
export function tokenize(text: string): string[] {
  if (!text) return [];

  const tokens: string[] = [];
  const lower = text.toLowerCase();

  for (const word of lower.match(/[a-z0-9]+/g) ?? []) {
    if (word.length > 1 && !STOP_WORDS.has(word)) tokens.push(word);
  }

  for (const segment of lower.match(/[\u4e00-\u9fa5]+/g) ?? []) {
    if (segment.length === 1) {
      tokens.push(segment);
      continue;
    }
    for (let i = 0; i < segment.length - 1; i++) {
      const gram = segment.slice(i, i + 2);
      if (!STOP_WORDS.has(gram)) tokens.push(gram);
    }
  }

  // 概念标签：语义层补充
  for (const concept of extractConcepts(lower)) {
    for (let i = 0; i < CONCEPT_WEIGHT; i++) tokens.push(concept);
  }

  return tokens;
}

/** 概念标签的重复次数，等效于提升其在向量中的权重 */
const CONCEPT_WEIGHT = 4;

type TermVector = Map<string, number>;

function termFrequency(tokens: string[]): TermVector {
  const tf: TermVector = new Map();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  return tf;
}

/**
 * 构建 IDF 表。
 * 平滑公式 log((N+1)/(df+1)) + 1 避免除零，并抑制极端权重。
 * 在越少文档中出现的词区分度越高，权重越大。
 */
export function buildIdf(corpus: string[][]): Map<string, number> {
  const df = new Map<string, number>();
  for (const tokens of corpus) {
    for (const term of new Set(tokens)) {
      df.set(term, (df.get(term) ?? 0) + 1);
    }
  }

  const total = corpus.length;
  const idf = new Map<string, number>();
  for (const [term, n] of df) {
    idf.set(term, Math.log((total + 1) / (n + 1)) + 1);
  }
  return idf;
}

/**
 * 余弦相似度 + 可解释的命中词。
 *
 * IDF 加权保证「我觉得」这类高频词不会主导结果，而「考研」「租房」
 * 这类特征词能真正决定匹配。
 */
export function similarity(
  tokensA: string[],
  tokensB: string[],
  idf: Map<string, number>,
): { score: number; reasons: string[] } {
  const tfA = termFrequency(tokensA);
  const tfB = termFrequency(tokensB);

  let dot = 0;
  let normA = 0;
  let normB = 0;
  const hits: Array<{ term: string; weight: number }> = [];

  for (const [term, freq] of tfA) {
    const w = freq * (idf.get(term) ?? 1);
    normA += w * w;

    const freqB = tfB.get(term);
    if (freqB !== undefined) {
      const product = w * freqB * (idf.get(term) ?? 1);
      dot += product;
      hits.push({ term, weight: product });
    }
  }

  for (const [term, freq] of tfB) {
    const w = freq * (idf.get(term) ?? 1);
    normB += w * w;
  }

  if (normA === 0 || normB === 0 || dot === 0) {
    return { score: 0, reasons: [] };
  }

  const score = Math.min(dot / (Math.sqrt(normA) * Math.sqrt(normB)), 1);

  // 只展示语义完整的词，避免「的很」「我也」这类噪声出现在匹配理由中；
  // 概念标签优先展示（权重更高会自然排前），并去掉内部使用的 # 前缀
  const reasons = hits
    .filter((h) => isMeaningful(h.term))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 4)
    .map((h) =>
      h.term.startsWith(CONCEPT_PREFIX) ? h.term.slice(1) : h.term,
    );

  return { score, reasons };
}
