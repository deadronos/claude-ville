const DEFAULT_AGENT_NAME_POOLS = {
  en: [
    'Atlas', 'Nova', 'Cipher', 'Pixel', 'Spark',
    'Bolt', 'Echo', 'Flux', 'Helix', 'Onyx',
    'Prism', 'Qubit', 'Rune', 'Sage', 'Vex',
  ],
  ko: {
    surnames: [
      '김', '이', '박', '최', '정', '강', '조', '윤', '장', '임',
      '한', '오', '서', '신', '권', '황', '안', '송', '류', '홍',
    ],
    titles: [
      '대표', '실장', '부장', '과장', '차장', '팀장', '이사',
      '수석', '책임', '선임', '주임', '대리', '매니저', '센터장', '국장',
    ],
  },
};

function toList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  if (typeof value !== 'string') {
    return [];
  }

  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeNamePools(rawPools = {}) {
  const en = toList(rawPools.en || rawPools.agentNames || rawPools.agentNamePool);
  const koRaw = rawPools.ko || {};
  const surnames = toList(koRaw.surnames || rawPools.koSurnames || rawPools.ko_surnames);
  const titles = toList(koRaw.titles || rawPools.koTitles || rawPools.ko_titles);

  return {
    en: en.length > 0 ? en : DEFAULT_AGENT_NAME_POOLS.en,
    ko: {
      surnames: surnames.length > 0 ? surnames : DEFAULT_AGENT_NAME_POOLS.ko.surnames,
      titles: titles.length > 0 ? titles : DEFAULT_AGENT_NAME_POOLS.ko.titles,
    },
  };
}

function buildRuntimeConfig(env = process.env) {
  const hubHttpUrl = env.HUB_HTTP_URL || env.HUB_URL || 'http://localhost:3030';
  const hubWsUrl = env.HUB_WS_URL || `${hubHttpUrl.replace(/^http/, 'ws').replace(/\/$/, '')}/ws`;

  return {
    hubHttpUrl,
    hubWsUrl,
    agentNamePools: normalizeNamePools({
      en: env.CLAUDEVILLE_AGENT_NAME_POOL,
      ko: {
        surnames: env.CLAUDEVILLE_AGENT_NAME_POOL_KO_SURNAMES,
        titles: env.CLAUDEVILLE_AGENT_NAME_POOL_KO_TITLES,
      },
    }),
  };
}

module.exports = {
  DEFAULT_AGENT_NAME_POOLS,
  normalizeNamePools,
  buildRuntimeConfig,
};
