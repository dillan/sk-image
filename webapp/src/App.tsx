import { useCallback, useEffect, useState } from 'react';
import type { ComponentType, SVGProps } from 'react';
import { useCluster } from './lib/router';
import type { Cluster } from './lib/router';
import { LibraryIcon, CollectionsIcon, SettingsIcon } from './components/icons';
import { LibraryScreen } from './screens/LibraryScreen';
import { CollectionsScreen } from './screens/CollectionsScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { UploadProgress } from './components/UploadProgress';
import { useUploadQueue } from './lib/uploads';
import { useRevisionPolling } from './lib/useRevisionPolling';
import { api, goToLogin } from './api';
import type { Collection, PluginConfig } from './api';

/** How often to poll the change token so edits made in another browser show up here. */
const REVISION_POLL_MS = 10_000;

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
  const [uploadTick, setUploadTick] = useState(0);

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

  // A file dropped anywhere outside a drop zone would otherwise make the browser navigate to it and
  // tear down the whole app — swallow stray file drops for the app's lifetime.
  useEffect(() => {
    const prevent = (e: globalThis.DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    };
    window.addEventListener('dragover', prevent);
    window.addEventListener('drop', prevent);
    return () => {
      window.removeEventListener('dragover', prevent);
      window.removeEventListener('drop', prevent);
    };
  }, []);

  // The upload queue lives here, above the tab switch, so uploads keep going and stay visible when
  // the user browses to Collections/Settings mid-batch.
  const uploads = useUploadQueue(
    config?.maxUploadBytes ?? 10 * 1024 * 1024,
    () => setUploadTick((t) => t + 1),
    goToLogin,
  );

  // Auto-refresh when the library changes elsewhere (another browser/device).
  useRevisionPolling(() => {
    setUploadTick((t) => t + 1);
    refreshCollections();
  }, REVISION_POLL_MS);

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
        <UploadProgress
          items={uploads.items}
          stats={uploads.stats}
          onCancel={uploads.cancel}
          onClear={uploads.clear}
        />
        {cluster === 'library' && (
          <LibraryScreen
            collections={collections}
            enqueue={uploads.enqueue}
            uploadTick={uploadTick}
            config={config}
          />
        )}
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
