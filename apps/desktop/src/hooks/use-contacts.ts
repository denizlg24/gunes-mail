"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useDeferredValue, useEffect } from "react";
import { create } from "zustand";

import { getApi } from "@/lib/api";
import type { Contact } from "@/lib/types";

export function useContactSearch(query: string) {
  const deferred = useDeferredValue(query.trim().toLowerCase());
  return useQuery({
    queryKey: ["contacts", deferred],
    queryFn: () => getApi().searchContacts(deferred),
    enabled: deferred.length > 0,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
}

const usePhotos = create<{ photos: Record<string, string | null> }>()(() => ({ photos: {} }));

const pending = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/** Batches avatar lookups from every visible row into one request. */
function requestPhoto(email: string) {
  if (email in usePhotos.getState().photos || pending.has(email)) return;
  pending.add(email);
  flushTimer ??= setTimeout(async () => {
    const batch = [...pending].slice(0, 200);
    batch.forEach((e) => pending.delete(e));
    flushTimer = null;
    try {
      const found = await getApi().contactPhotos(batch);
      usePhotos.setState((s) => ({
        photos: { ...s.photos, ...Object.fromEntries(batch.map((e) => [e, found[e] ?? null])) },
      }));
    } catch {
      usePhotos.setState((s) => ({ photos: { ...s.photos, ...Object.fromEntries(batch.map((e) => [e, null])) } }));
    }
    if (pending.size) requestPhoto([...pending][0]);
  }, 60);
}

export function useContactPhoto(email: string | undefined): string | null {
  const key = email?.toLowerCase() ?? "";
  const photo = usePhotos((s) => (key ? s.photos[key] : null));
  useEffect(() => {
    if (key) requestPhoto(key);
  }, [key]);
  return photo ?? null;
}

export function rememberPhotos(contacts: Contact[]) {
  const known = Object.fromEntries(contacts.map((c) => [c.email.toLowerCase(), c.photoUrl ?? null]));
  usePhotos.setState((s) => ({ photos: { ...s.photos, ...known } }));
}
