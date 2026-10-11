import React, { useState } from 'react';
import { MapPin, Sparkles, Navigation, Loader2, ArrowRight } from 'lucide-react';
import { SAMPLE_TRAILS, type SampleTrail } from '../data/sampleTrails';

export interface SampleTrailsSelectorProps {
  onLoadBundleFile: (file: File, trail: SampleTrail) => Promise<void> | void;
  disabled?: boolean;
}

export const SampleTrailsSelector: React.FC<SampleTrailsSelectorProps> = ({
  onLoadBundleFile,
  disabled = false
}) => {
  const [loadingTrailId, setLoadingTrailId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSelectTrail = async (trail: SampleTrail): Promise<void> => {
    if (disabled || loadingTrailId) return;

    setLoadingTrailId(trail.id);
    setErrorMessage(null);

    try {
      console.log(`[SampleTrails] Fetching pre-packaged trail bundle: ${trail.bundleUrl}`);
      const response = await fetch(trail.bundleUrl);

      if (!response.ok) {
        throw new Error(`Failed to download demo bundle (${response.status}: ${response.statusText})`);
      }

      const blob = await response.blob();
      const bundleFile = new File([blob], `${trail.id}.zip`, {
        type: 'application/zip'
      });

      await onLoadBundleFile(bundleFile, trail);
    } catch (err: unknown) {
      console.error('[SampleTrails] Error loading sample bundle:', err);
      const msg = err instanceof Error ? err.message : 'Failed to load sample trail.';
      setErrorMessage(msg);
      alert(`Could not load sample trail: ${msg}`);
    } finally {
      setLoadingTrailId(null);
    }
  };

  return (
    <div className="sample-trails-container">
      <div className="sample-trails-header">
        <div className="sample-trails-title">
          <Sparkles size={18} className="text-amber-400" />
          <span>Curated 1-Click Demo Trails</span>
          <span className="sample-trials-badge-fast">60s TEST</span>
        </div>
        <p className="sample-trails-subtitle">
          Instant offline-ready tours with studio narration. No GPX files or API keys required.
        </p>
      </div>

      {errorMessage && (
        <div className="sample-trails-error">
          <span>⚠️ {errorMessage}</span>
        </div>
      )}

      <div className="sample-trails-grid">
        {SAMPLE_TRAILS.map((trail) => {
          const isLoading = loadingTrailId === trail.id;

          return (
            <div
              key={trail.id}
              className={`sample-trail-card ${isLoading ? 'is-loading' : ''}`}
              onClick={() => void handleSelectTrail(trail)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  void handleSelectTrail(trail);
                }
              }}
            >
              <div className="sample-trail-card-top">
                <div className="sample-trail-name-group">
                  <h4 className="sample-trail-title">{trail.title}</h4>
                  <div className="sample-trail-location">
                    <MapPin size={12} />
                    <span>{trail.location}</span>
                  </div>
                </div>

                <div className="sample-trail-badges">
                  <span className="badge-pill-unesco">{trail.badge}</span>
                  <span className="badge-pill-quick">⚡ {trail.duration}</span>
                </div>
              </div>

              <p className="sample-trail-description">{trail.description}</p>

              <div className="sample-trail-footer">
                <div className="sample-trail-stops-meta">
                  <span>📍 {trail.stopsCount} stops</span>
                </div>

                <button
                  type="button"
                  className="btn-sample-load"
                  disabled={disabled || isLoading}
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleSelectTrail(trail);
                  }}
                >
                  {isLoading ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      <span>Unpacking...</span>
                    </>
                  ) : (
                    <>
                      <span>Load &amp; Explore</span>
                      <ArrowRight size={14} />
                    </>
                  )}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="judge-tip-box">
        <Navigation size={14} className="judge-tip-icon" />
        <span>
          <strong>Tip for Judges:</strong> After loading, tap <em>"GPS Simulator"</em> to test real
          audio vignettes in under a minute without walking.
        </span>
      </div>
    </div>
  );
};
