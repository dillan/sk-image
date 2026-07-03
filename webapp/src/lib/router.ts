import { useSyncExternalStore } from 'react';

export type Cluster = 'library' | 'collections' | 'settings';

const CLUSTERS: Cluster[] = ['library', 'collections', 'settings'];

function parse(): Cluster {
  const hash = window.location.hash.replace(/^#\/?/, '');
  return (CLUSTERS as string[]).includes(hash) ? (hash as Cluster) : 'library';
}

function subscribe(callback: () => void): () => void {
  window.addEventListener('hashchange', callback);
  return () => window.removeEventListener('hashchange', callback);
}

/** Minimal hash router — hash routing avoids needing a server deep-path fallback under the mount. */
export function useCluster(): [Cluster, (cluster: Cluster) => void] {
  const cluster = useSyncExternalStore(subscribe, parse, () => 'library' as Cluster);
  const navigate = (next: Cluster) => {
    window.location.hash = `#/${next}`;
  };
  return [cluster, navigate];
}
