/**
 * Значения, безопасные для клиентских компонентов.
 * Всё, что требует next/headers (cookie, серверные запросы), живёт в lib/api.ts —
 * его нельзя импортировать из 'use client'-компонента.
 */
export const API_PUBLIC = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001').replace(/\/+$/, '');
