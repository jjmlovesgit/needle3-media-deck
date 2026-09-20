/** Fetch only the configured loopback adapter; never arbitrary filesystem paths.
 * @param {boolean} refresh
 * @returns {Promise<{items: import('./types.js').MediaItem[], skipped:number}>}
 */
export async function loadSharedLibrary(refresh = false) {
  const response = await fetch('/api/library' + (refresh ? '?refresh=1' : ''));
  if (!response.ok) throw new Error('The shared media folder is unavailable. Check its configured path and retry.');
  const result = await response.json();
  if (!Array.isArray(result.items)) throw new Error('The shared library returned an invalid index.');
  const items = result.items.map(item => {
    if (!/^[a-f0-9]{64}$/.test(item.id) || item.url !== '/media/' + item.id ||
        typeof item.title !== 'string' || typeof item.reason !== 'string' ||
        !['mp3', 'original_mp4', 'karaoke_mp4'].includes(item.kind)) throw new Error('Invalid shared media record.');
    return { ...item, source: 'shared', file: item.url };
  });
  return { items, skipped: result.skipped || 0 };
}
