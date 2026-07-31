export type GuideLevel = 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
export type TeamRole = 'BUYER' | 'FARMER' | 'TECH' | 'MEDIABUYER' | 'MANAGER' | 'OTHER';

export const LEVEL_LABEL: Record<GuideLevel, string> = {
  BEGINNER: 'Новичок',
  INTERMEDIATE: 'Средний',
  ADVANCED: 'Продвинутый',
};

export const TEAM_ROLE_LABEL: Record<TeamRole, string> = {
  BUYER: 'Байер',
  FARMER: 'Фармер',
  TECH: 'Тех',
  MEDIABUYER: 'Медиабайер',
  MANAGER: 'Менеджер',
  OTHER: 'Другое',
};

export interface MediaRef {
  id: number;
  type: 'IMAGE' | 'VIDEO' | 'FILE';
  url: string;
  posterUrl: string | null;
  srcset: { avif: string | null; webp: string | null };
  alt: string | null;
  originalName: string;
  width: number | null;
  height: number | null;
  durationSec: number | null;
  sizeBytes: string;
}

export interface Tag {
  id: number;
  slug: string;
  title: string;
}

export interface CategoryNode {
  id: number;
  slug: string;
  title: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  parentId: number | null;
  sortOrder: number;
  guideCount: number;
  children: CategoryNode[];
}

export interface GuideCard {
  id: number;
  slug: string;
  title: string;
  summary: string | null;
  level: GuideLevel;
  readingTimeSec: number;
  isPinned: boolean;
  publishedAt: string | null;
  updatedAt: string;
  requiredForRoles: TeamRole[];
  category: { id: number; slug: string; title: string; icon: string | null; color: string | null };
  cover: MediaRef | null;
  tags: Tag[];
  /** Заполняется только на экранах «обязательное» и «мой прогресс» */
  readAt?: string | null;
  lastOpenedAt?: string | null;
}

export interface DocNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
}

export interface Heading {
  level: number;
  text: string;
  anchor: string;
}

export interface GuideFull {
  id: number;
  slug: string;
  title: string;
  summary: string | null;
  level: GuideLevel;
  readingTimeSec: number;
  version: number;
  publishedAt: string | null;
  updatedAt: string;
  requiredForRoles: TeamRole[];
  category: { id: number; slug: string; title: string; icon: string | null; color: string | null };
  author: { id: number; name: string } | null;
  tags: Tag[];
  cover: MediaRef | null;
  content: { type: 'doc'; content?: DocNode[] };
  media: Record<string, MediaRef>;
  guideRefs: Record<string, { id: number; slug: string; title: string; summary: string | null }>;
  toc: Heading[];
  related: GuideCard[];
}

export interface SearchHit {
  id: number;
  slug: string;
  title: string;
  summary: string | null;
  readingTimeSec: number;
  categoryTitle: string;
  categorySlug: string;
  rank: number;
  headline: string;
}

export function readingTimeLabel(sec: number): string {
  const min = Math.max(1, Math.round(sec / 60));
  const last = min % 10;
  const tens = min % 100;
  const word = tens >= 11 && tens <= 14 ? 'минут' : last === 1 ? 'минута' : last >= 2 && last <= 4 ? 'минуты' : 'минут';
  return `${min} ${word}`;
}
