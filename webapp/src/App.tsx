import { useCallback, useEffect, useState } from 'react';
import type { ComponentType, SVGProps } from 'react';
import { useCluster } from './lib/router';
import type { Cluster } from './lib/router';
import { LibraryIcon, CollectionsIcon, SettingsIcon } from './components/icons';
import { LibraryScreen } from './screens/LibraryScreen';
import { CollectionsScreen } from './screens/CollectionsScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { api } from './api';
import type { Collection, PluginConfig } from './api';

const NAV: { cluster: Cluster; label: string; Icon: ComponentType<SVGProps<SVGSVGElement>> }[] = [
  { cluster: 'library', label: 'Library', Icon: LibraryIcon },
  { cluster: 'collections', label: 'Collections', Icon: CollectionsIcon },
  { cluster: 'settings', label: 'Settings', Icon: SettingsIcon },
];

function NavButtons({
  current,
  onNavigate,
}: {
  current: Cluster;
  onNavigate: (cluster: Cluster) => void;
}) {
  return (
    <>
      {NAV.map(({ cluster, label, Icon }) => (
        <button
          key={cluster}
          type="button"
          className="navitem"
          aria-current={current === cluster ? 'page' : undefined}
          onClick={() => onNavigate(cluster)}
        >
          <Icon />
          <span>{label}</span>
        </button>
      ))}
    </>
  );
}

export function App() {
  const [cluster, navigate] = useCluster();
  const [collections, setCollections] = useState<Collection[]>([]);
  const [config, setConfig] = useState<PluginConfig | null>(null);

  const refreshCollections = useCallback(() => {
    api
      .listCollections()
      .then(setCollections)
      .catch(() => setCollections([]));
  }, []);

  useEffect(() => {
    refreshCollections();
    api
      .config()
      .then(setConfig)
      .catch(() => setConfig(null));
  }, [refreshCollections]);

  return (
    <div className="shell">
      <nav className="rail" aria-label="Primary">
        <img
          className="rail__logo"
          src={`${import.meta.env.BASE_URL}icon.svg`}
          alt="SK Image"
          width={64}
          height={64}
        />
        <div className="rail__items">
          <NavButtons current={cluster} onNavigate={navigate} />
        </div>
      </nav>

      <div className="content">
        {cluster === 'library' && <LibraryScreen collections={collections} config={config} />}
        {cluster === 'collections' && (
          <CollectionsScreen collections={collections} onChange={refreshCollections} />
        )}
        {cluster === 'settings' && <SettingsScreen config={config} />}
      </div>

      <nav className="tabbar" aria-label="Primary">
        <NavButtons current={cluster} onNavigate={navigate} />
      </nav>
    </div>
  );
}
