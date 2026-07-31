import axios from 'axios';

// Токен живёт в httpOnly-cookie (PLAN §5), поэтому в localStorage ничего не храним —
// контент чувствительный. Отсюда withCredentials на каждом запросе.
export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL + '/api',
  withCredentials: true,
});

let refreshing: Promise<boolean> | null = null;

/** Один общий refresh на все параллельные 401 — иначе ротация токенов подерётся сама с собой. */
async function refreshOnce(): Promise<boolean> {
  if (!refreshing) {
    refreshing = axios
      .post(import.meta.env.VITE_API_URL + '/api/auth/refresh', {}, { withCredentials: true })
      .then(() => true)
      .catch(() => false)
      .finally(() => {
        // сбрасываем чуть позже, чтобы «хвост» параллельных запросов успел переиспользовать результат
        setTimeout(() => {
          refreshing = null;
        }, 0);
      });
  }
  return refreshing;
}

api.interceptors.response.use(
  (r) => r,
  async (err) => {
    const status = err?.response?.status;
    const cfg = err?.config;
    const url: string = cfg?.url ?? '';

    // 401 → один раз пробуем обновить access-токен и повторить запрос
    if (status === 401 && cfg && !cfg.__retried && !url.includes('/auth/')) {
      cfg.__retried = true;
      if (await refreshOnce()) return api(cfg);
    }

    if (status === 401 && !location.pathname.startsWith('/login')) {
      location.href = '/login';
    }
    return Promise.reject(err);
  },
);

/** Человекочитаемый текст ошибки из ответа API. */
export function errText(e: unknown): string {
  const anyE = e as any;
  return (
    anyE?.response?.data?.error ??
    anyE?.response?.data?.message ??
    anyE?.message ??
    'Неизвестная ошибка'
  );
}

// ===== Типы, общие для админки =====

export type Role = 'NONE' | 'VIEWER' | 'EDITOR' | 'ADMIN';
export type TeamRole = 'BUYER' | 'FARMER' | 'TECH' | 'MEDIABUYER' | 'MANAGER' | 'OTHER';
export type GuideStatus = 'DRAFT' | 'IN_REVIEW' | 'PUBLISHED' | 'ARCHIVED';
export type GuideLevel = 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
export type MediaType = 'IMAGE' | 'VIDEO' | 'FILE';
export type MediaStatus = 'PENDING' | 'UPLOADING' | 'PROCESSING' | 'READY' | 'FAILED';

export interface Me {
  id: number;
  name: string;
  login: string | null;
  role: Role;
  teamRole: TeamRole;
  email: string | null;
  telegramUsername: string | null;
  telegramId: string | null;
  isActive: boolean;
}

export interface Category {
  id: number;
  slug: string;
  title: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  parentId: number | null;
  sortOrder: number;
  guideCount?: number;
  children?: Category[];
}

export interface Tag {
  id: number;
  slug: string;
  title: string;
  guideCount?: number;
}

export interface MediaVariant {
  w?: number;
  h?: number;
  fmt?: string;
  key: string;
  size?: number;
  height?: number;
  bitrate?: number;
}

export interface Media {
  id: number;
  type: MediaType;
  status: MediaStatus;
  key: string;
  originalName: string;
  mime: string;
  sizeBytes: string;
  sha256: string;
  width: number | null;
  height: number | null;
  durationSec: number | null;
  blurhash: string | null;
  variants: MediaVariant[];
  posterKey: string | null;
  alt: string | null;
  title: string | null;
  error: string | null;
  createdAt: string;
  processedAt: string | null;
  url: string;
  posterUrl: string | null;
  /** Готовые srcset по форматам — собраны на backend */
  srcset: { avif: string | null; webp: string | null };
  usedIn?: { id: number; title: string; slug: string }[];
}

export interface GuideListItem {
  id: number;
  slug: string;
  title: string;
  summary: string | null;
  status: GuideStatus;
  level: GuideLevel;
  version: number;
  categoryId: number;
  category?: { id: number; title: string; slug: string };
  isPinned: boolean;
  sortOrder: number;
  reviewAt: string | null;
  publishedAt: string | null;
  updatedAt: string;
  author?: { id: number; name: string };
  tags?: Tag[];
}

export interface GuideFull extends GuideListItem {
  content: any;
  contentDraft: any;
  readingTimeSec: number;
  requiredForRoles: TeamRole[];
  coverId: number | null;
  cover: Media | null;
  related: { id: number; title: string; slug: string }[];
  lockedBy: { id: number; name: string } | null;
  lockedAt: string | null;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}
