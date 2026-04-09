import { Appearance } from '../domain/value-objects/Appearance.js';
import { i18n } from './i18n.js';
import { getRuntimeConfig } from './runtime.js';

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

function getNamePools() {
    const runtime = getRuntimeConfig();
    return normalizeNamePools(runtime.agentNamePools || runtime.agentNames || runtime.namePools || DEFAULT_AGENT_NAME_POOLS);
}

function isRawIdentifier(value) {
    if (!value) return false;
    const text = String(value).trim();
    if (text.length < 16) return false;
    if (/\s/.test(text)) return false;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)) return true;
    if (/^[0-9a-f]{12,}$/i.test(text)) return true;
    if (/^([a-z0-9]{8,}[-_:]){1,}[a-z0-9]{4,}$/i.test(text)) return true;
    return text.length >= 24;
}

export function generateAgentDisplayName(seed, lang = i18n.lang) {
    const pools = getNamePools();
    const hash = Appearance.hashCode(String(seed || 'agent'));
    const normalizedLang = lang === 'ko' ? 'ko' : 'en';

    if (normalizedLang === 'ko') {
        const surnames = pools.ko.surnames;
        const titles = pools.ko.titles;
        const surname = surnames[Math.abs(hash) % surnames.length];
        const title = titles[Math.abs(hash >> 4) % titles.length];
        return `${surname}${title}`;
    }

    return pools.en[Math.abs(hash) % pools.en.length];
}

export function resolveAgentDisplayName(session, teamInfo = null, lang = i18n.lang) {
    const candidate = teamInfo?.name || session.displayName || session.agentName || null;

    if (candidate && !isRawIdentifier(candidate)) {
        return {
            name: candidate,
            nameIsCustom: true,
            nameSeed: session.agentId || session.sessionId || candidate,
        };
    }

    const nameSeed = session.agentId || session.sessionId || candidate || 'agent';
    return {
        name: generateAgentDisplayName(nameSeed, lang),
        nameIsCustom: false,
        nameSeed,
    };
}
