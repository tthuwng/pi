export function rememberBoundedEntry<K, V>(
	cache: Map<K, V>,
	key: K,
	value: V,
	maxEntries: number,
): void {
	cache.delete(key);
	cache.set(key, value);
	trimOldestEntries(cache, maxEntries);
}

export function trimOldestEntries<K, V>(
	cache: Map<K, V>,
	maxEntries: number,
): void {
	while (cache.size > maxEntries) {
		const oldestKey = cache.keys().next().value;
		if (oldestKey === undefined) break;
		cache.delete(oldestKey);
	}
}

export function forgetStringEntry<K>(cache: Map<K, string>, key: K): number {
	const existing = cache.get(key);
	if (existing === undefined) return 0;
	cache.delete(key);
	return existing.length;
}

export function rememberBoundedStringEntry<K>(
	cache: Map<K, string>,
	key: K,
	value: string,
	currentChars: number,
	maxEntries: number,
	maxChars: number,
): number {
	currentChars -= forgetStringEntry(cache, key);
	cache.set(key, value);
	currentChars += value.length;

	while (cache.size > maxEntries || currentChars > maxChars) {
		const oldestKey = cache.keys().next().value;
		if (oldestKey === undefined) break;
		currentChars -= forgetStringEntry(cache, oldestKey);
	}

	return currentChars;
}
