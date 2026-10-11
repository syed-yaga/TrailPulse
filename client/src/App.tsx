import React, { useState, useEffect, useRef } from "react";
import {
  Compass,
  Headphones,
  MapPin,
  Volume2,
  Play,
  Pause,
  Square,
  UploadCloud,
  CheckCircle2,
  Radio,
  EyeOff,
  Navigation,
  FileDown,
  RotateCcw,
  Wifi,
  WifiOff,
  Archive,
} from "lucide-react";
import { get } from "idb-keyval";

import type {
  Coordinate,
  TrailManifest,
  WaypointTrigger,
} from "../../shared/types";
import { MUIR_WOODS_GPX } from "./data/muirWoodsSample";
import {
  unpackAndStoreBundle,
  getCachedManifest,
  clearCachedTour,
  getStoredAudioBlob,
} from "./services/zipService";
import { unpackTrailBundle } from "./services/bundleImporter";
import {
  TrailSpatialEngine,
  calculateDistanceMeters,
  type TrailSpatialState,
} from "./services/geofenceEngine";
import { SampleTrailsSelector } from "./components/SampleTrailsSelector";

type AppScreenState = "prep" | "generating" | "ready" | "hiking";

export default function App(): React.JSX.Element {
  const [appState, setAppState] = useState<AppScreenState>("prep");
  const [manifest, setManifest] = useState<TrailManifest | null>(null);
  const [_currentCoord, setCurrentCoord] = useState<Coordinate | null>(null);
  const [gpxData, setGpxData] = useState<string | null>(null);
  const [trailName, setTrailName] = useState<string>(
    "Muir Woods Redwood Sanctuary Trail",
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [zipBlob, setZipBlob] = useState<Blob | null>(null);

  const [genProgress, setGenProgress] = useState<number>(0);
  const [genStage, setGenStage] = useState<string>("");

  // Manual Preview State & Refs
  const [currentlyPlayingId, setCurrentlyPlayingId] = useState<string | null>(
    null,
  );
  const [isPlayingTestAudio, setIsPlayingTestAudio] = useState<boolean>(false);
  const [previewStatus, setPreviewStatus] = useState<string>(
    "Ready to preview audio",
  );
  const [_activePoi, setActivePoi] = useState<string | null>(null);

  const activeAudioRef = useRef<HTMLAudioElement>(new Audio());
  const audioCacheRef = useRef<Map<string, string>>(new Map());
  const manifestRef = useRef<TrailManifest | null>(manifest);

  const [spatialState, setSpatialState] = useState<TrailSpatialState>({
    currentPosition: null,
    accuracyMeters: null,
    targetWaypoint: null,
    distanceToTargetMeters: null,
    nearestWaypoint: null,
    distanceToNearestMeters: null,
    triggerRadiusMeters: 40,
    isTriggered: false,
    isPlaying: false,
    currentPlayingWaypoint: null,
    lastTriggerTimes: new Map(),
    visitedWaypointIds: new Set(),
    isTargetCompleted: false,
    isSimulating: false,
  });

  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [showSimPanel, setShowSimPanel] = useState<boolean>(false);

  const engineRef = useRef<TrailSpatialEngine | null>(null);
  const gpxInputRef = useRef<HTMLInputElement | null>(null);
  const zipInputRef = useRef<HTMLInputElement | null>(null);

  manifestRef.current = manifest;

  useEffect(() => {
    const handleOnline = (): void => setIsOnline(true);
    const handleOffline = (): void => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    getCachedManifest().then((cached) => {
      if (cached && cached.waypoints && cached.waypoints.length > 0) {
        setManifest(cached);
        setTrailName(cached.trail_name);
        setAppState("ready");
      }
    });

    const activeAudio = activeAudioRef.current;

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      if (engineRef.current) {
        engineRef.current.destroy();
      }
      activeAudio.pause();
      // Revoke created audio object URLs
      for (const url of audioCacheRef.current.values()) {
        URL.revokeObjectURL(url);
      }
      audioCacheRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (manifest) {
      if (engineRef.current) {
        engineRef.current.destroy();
      }
      engineRef.current = new TrailSpatialEngine(manifest);
      const unsubscribe = engineRef.current.subscribe((state) => {
        setSpatialState(state);
        setCurrentCoord(state.currentPosition);
      });
      return () => unsubscribe();
    }
  }, [manifest]);

  const handleLoadSample = (): void => {
    setGpxData(MUIR_WOODS_GPX);
    setTrailName("Muir Woods Redwood Sanctuary Trail");
    setErrorMessage(null);
  };

  const handleGpxUpload = (file: File): void => {
    const reader = new FileReader();
    reader.onload = (event: ProgressEvent<FileReader>): void => {
      const content = event.target?.result;
      if (typeof content === "string") {
        setGpxData(content);
        const nameMatch = content.match(/<name>(.*?)<\/name>/i);
        if (nameMatch && nameMatch[1]) {
          setTrailName(nameMatch[1].trim());
        } else {
          setTrailName(file.name.replace(/\.gpx$/i, ""));
        }
        setErrorMessage(null);
      }
    };
    reader.readAsText(file);
  };

  const handleImportZipBundle = async (
    file: File,
    autoStartHiking: boolean = false,
  ): Promise<void> => {
    setAppState("generating");
    setGenProgress(20);
    setGenStage("Reading archive in browser...");
    setErrorMessage(null);

    try {
      const unpackedManifest = await unpackTrailBundle(file, {
        onProgress: (stage: string, percent: number): void => {
          setGenStage(stage);
          setGenProgress(percent);
        },
      });

      setManifest(unpackedManifest);
      setTrailName(unpackedManifest.trail_name);
      setZipBlob(file);

      // Pre-populate memory audio URL cache for immediate playback
      if (unpackedManifest.audioBlobs) {
        for (const [key, blob] of unpackedManifest.audioBlobs.entries()) {
          const url = URL.createObjectURL(blob);
          audioCacheRef.current.set(key, url);
        }
      }

      setGenProgress(100);
      setGenStage("Bundle ready! You can now start hiking offline.");

      await new Promise((r) => setTimeout(r, 450));

      if (autoStartHiking) {
        // Unlock audio context and immediately engage Live GPS HUD & simulation controls
        if (engineRef.current) {
          engineRef.current.unlockAudio();
          engineRef.current.startTracking();
        }
        setAppState("hiking");
      } else {
        setAppState("ready");
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to import ZIP bundle.";
      console.error("ZIP bundle import failed:", err);
      setErrorMessage(message);
      setAppState("prep");
    }
  };

  const handleLoadSampleTrail = async (file: File): Promise<void> => {
    await handleImportZipBundle(file, true);
  };

  const handleZipInputChange = (
    e: React.ChangeEvent<HTMLInputElement>,
  ): void => {
    const file = e.target.files?.[0];
    if (!file) return;
    handleImportZipBundle(file);
    e.target.value = "";
  };

  const handleGpxInputChange = (
    e: React.ChangeEvent<HTMLInputElement>,
  ): void => {
    const file = e.target.files?.[0];
    if (!file) return;
    handleGpxUpload(file);
    e.target.value = "";
  };

  const handleGenerateBundle = async (): Promise<void> => {
    const payloadGpx = gpxData || MUIR_WOODS_GPX;
    setAppState("generating");
    setGenProgress(15);
    setGenStage(
      "Analyzing GPX topography & sampling 3–6 key trigger points...",
    );
    setErrorMessage(null);

    try {
      const formData = new FormData();
      const gpxBlob = new Blob([payloadGpx], { type: "application/gpx+xml" });
      formData.append("gpx", gpxBlob, "trail.gpx");

      setGenProgress(35);
      setGenStage(
        "Querying OpenStreetMap Overpass for landmark POIs within 400m...",
      );

      await new Promise((r) => setTimeout(r, 600));
      setGenProgress(55);
      setGenStage(
        "Gemma 2: Generating 45–60 word sensory field naturalist vignettes...",
      );

      const response = await fetch("/api/trail/bundle", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(
          errorData.error || `Server responded with HTTP ${response.status}`,
        );
      }

      setGenProgress(80);
      setGenStage(
        "Synthesizing audio & packaging into streaming ZIP archive...",
      );

      const arrayBuffer = await response.arrayBuffer();
      const zipBytes = new Uint8Array(arrayBuffer);
      setZipBlob(new Blob([zipBytes], { type: "application/zip" }));

      setGenProgress(95);
      setGenStage(
        "Unpacking in RAM via fflate & caching audio into IndexedDB...",
      );

      const { manifest: unpackedManifest, audioBlobs } =
        await unpackAndStoreBundle(zipBytes);
      setManifest(unpackedManifest);
      setTrailName(unpackedManifest.trail_name);

      // Pre-populate memory audio URL cache for immediate playback
      for (const [key, blob] of audioBlobs.entries()) {
        const url = URL.createObjectURL(blob);
        audioCacheRef.current.set(key, url);
      }

      setGenProgress(100);
      setGenStage("Tour bundle cached and 100% offline ready!");

      await new Promise((r) => setTimeout(r, 500));
      setAppState("ready");
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "Failed to generate trail bundle.";
      console.error("Bundle generation failed:", err);
      setErrorMessage(message);
      setAppState("prep");
    }
  };

  /**
   * Manual Test Play / Audio Preview Handler
   */
  const handleManualPlay = async (wp: WaypointTrigger): Promise<void> => {
    // If the clicked waypoint is already playing, toggle pause
    if (currentlyPlayingId === wp.id && !activeAudioRef.current.paused) {
      activeAudioRef.current.pause();
      setCurrentlyPlayingId(null);
      setPreviewStatus(`Paused: ${wp.name}`);
      return;
    }

    // Stop engine playback if active
    if (engineRef.current) {
      engineRef.current.stopAudio();
    }

    // Resolve audio URL from RAM cache or IndexedDB
    let audioUrl =
      audioCacheRef.current.get(wp.audio_file) ||
      audioCacheRef.current.get(wp.id);

    if (!audioUrl) {
      const blob =
        (await get<Blob>(wp.audio_file)) || (await getStoredAudioBlob(wp.id));
      if (blob instanceof Blob) {
        audioUrl = URL.createObjectURL(blob);
        audioCacheRef.current.set(wp.audio_file, audioUrl);
        audioCacheRef.current.set(wp.id, audioUrl);
      }
    }

    if (!audioUrl) {
      setPreviewStatus(`Audio file not found for ${wp.name}`);
      return;
    }

    activeAudioRef.current.src = audioUrl;
    activeAudioRef.current.onended = (): void => {
      setCurrentlyPlayingId(null);
      setPreviewStatus("Preview finished.");
    };

    try {
      await activeAudioRef.current.play();
      setCurrentlyPlayingId(wp.id);
      setActivePoi(wp.name);
      setPreviewStatus(`Previewing: ${wp.name}`);

      if ("mediaSession" in navigator && manifestRef.current) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: wp.name,
          artist: "TrailPulse (Preview Mode)",
          album: manifestRef.current.trail_name,
        });
      }
    } catch (err: unknown) {
      console.error("Playback error:", err);
      setPreviewStatus(`Could not play audio: ${(err as Error).message}`);
    }
  };

  /**
   * Global Stop Audio Handler
   */
  const handleStopAudio = (): void => {
    activeAudioRef.current.pause();
    activeAudioRef.current.currentTime = 0;
    setCurrentlyPlayingId(null);
    setIsPlayingTestAudio(false);
    setPreviewStatus("Audio stopped.");
    if (engineRef.current) {
      engineRef.current.stopAudio();
    }
  };

  /**
   * Test Play / Audio Preview Handler for Active Hiking View
   */
  const handleTestPlayAudio = async (): Promise<void> => {
    if (!manifest) {
      setPreviewStatus("No trail manifest loaded.");
      return;
    }

    // Toggle pause if already playing
    if (isPlayingTestAudio && !activeAudioRef.current.paused) {
      activeAudioRef.current.pause();
      setIsPlayingTestAudio(false);
      setPreviewStatus("Audio paused.");
      return;
    }

    // Stop engine playback if active
    if (engineRef.current) {
      engineRef.current.stopAudio();
    }

    // Target current active waypoint or default to waypoint 1
    const targetWaypoint: WaypointTrigger | undefined =
      spatialState.targetWaypoint ||
      spatialState.nearestWaypoint ||
      spatialState.currentPlayingWaypoint ||
      manifest.waypoints[0];

    if (!targetWaypoint) {
      setPreviewStatus("No waypoints found in manifest.");
      return;
    }

    let audioUrl =
      audioCacheRef.current.get(targetWaypoint.audio_file) ||
      audioCacheRef.current.get(targetWaypoint.id);

    // Fallback to IndexedDB if memory map lost reference
    if (!audioUrl) {
      const storedBlob =
        (await get<Blob>(targetWaypoint.audio_file)) ||
        (await getStoredAudioBlob(targetWaypoint.id));
      if (storedBlob instanceof Blob) {
        audioUrl = URL.createObjectURL(storedBlob);
        audioCacheRef.current.set(targetWaypoint.audio_file, audioUrl);
        audioCacheRef.current.set(targetWaypoint.id, audioUrl);
      }
    }

    if (!audioUrl) {
      setPreviewStatus(`Audio not found for ${targetWaypoint.name}.`);
      return;
    }

    try {
      activeAudioRef.current.src = audioUrl;
      activeAudioRef.current.onended = (): void => {
        setIsPlayingTestAudio(false);
        setCurrentlyPlayingId(null);
        setPreviewStatus(`Finished playing: ${targetWaypoint.name}`);
      };

      await activeAudioRef.current.play();
      setIsPlayingTestAudio(true);
      setCurrentlyPlayingId(targetWaypoint.id);
      setActivePoi(targetWaypoint.name);
      setPreviewStatus(`Playing: ${targetWaypoint.name}`);

      // Update MediaSession for Bluetooth earbuds / lock screen
      if ("mediaSession" in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: targetWaypoint.name,
          artist: "TrailPulse Narration",
          album: manifest.trail_name,
        });
      }
    } catch (err: unknown) {
      console.error("Playback failed:", err);
      setIsPlayingTestAudio(false);
      setPreviewStatus(`Audio playback failed: ${(err as Error).message}`);
    }
  };

  const handleStartHiking = (): void => {
    handleStopAudio();

    // 1. Audio Autoplay Unlock: Immediately play and pause a silent audio buffer
    // to unlock HTML5 audio permissions for future background triggers on mobile.
    const silentWavUri =
      "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";

    if (activeAudioRef.current) {
      try {
        activeAudioRef.current.src = silentWavUri;
        const playPromise = activeAudioRef.current.play();
        if (playPromise !== undefined) {
          playPromise
            .then(() => {
              activeAudioRef.current.pause();
              activeAudioRef.current.currentTime = 0;
            })
            .catch((err) => {
              console.warn("[App] activeAudioRef silent unlock note:", err);
            });
        }
      } catch (err) {
        console.warn("[App] activeAudioRef unlock error:", err);
      }
    }

    // Unlock engine internal audio and start satellite tracking (no premature simulation)
    if (engineRef.current) {
      engineRef.current.unlockAudio();
      engineRef.current.startTracking();
    }

    setAppState("hiking");
  };

  const handleForcePlayNearest = async (): Promise<void> => {
    const target =
      spatialState.targetWaypoint ||
      spatialState.nearestWaypoint ||
      manifest?.waypoints?.[0];
    if (!target) {
      alert("No landmark waypoint available to play.");
      return;
    }

    try {
      console.log(
        `[HUD] Force playing target waypoint audio: "${target.name}" (${target.id})`,
      );
      if (engineRef.current) {
        await engineRef.current.playWaypointAudio(target);
      } else {
        await handleManualPlay(target);
      }
    } catch (err: unknown) {
      console.error("[HUD] Force play error:", err);
      alert(
        `Force play failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  const handleExitHiking = (): void => {
    if (engineRef.current) {
      engineRef.current.stopTracking();
      engineRef.current.stopAudio();
    }
    handleStopAudio();
    setAppState("ready");
  };

  const handleResetTour = async (): Promise<void> => {
    handleStopAudio();
    if (engineRef.current) {
      engineRef.current.resetVisited();
      engineRef.current.destroy();
    }
    await clearCachedTour();
    setManifest(null);
    setZipBlob(null);
    setGpxData(null);
    setAppState("prep");
  };

  const handleDownloadZip = (): void => {
    if (!zipBlob) return;
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${trailName.toLowerCase().replace(/\s+/g, "_")}_bundle.zip`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <div className="brand">
          <div className="brand-icon">
            <Compass size={22} />
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center" }}>
              <span className="brand-title">TrailPulse</span>
            </div>
          </div>
        </div>

        <div className="badge-offline">
          {isOnline ? (
            <>
              <Wifi size={14} /> Wi-Fi Ready
            </>
          ) : (
            <>
              <WifiOff size={14} color="#4ade80" />{" "}
              <span className="dot"></span> 100% Offline
            </>
          )}
        </div>
      </header>

      {/* Main Philosophy Banner */}
      <div className="philosophy-banner">
        <div className="icon-box">
          <EyeOff size={20} />
        </div>
        <div>
          <h3>Zero Screen-Time Outdoors</h3>
          <p>
            Generate your tour at home. When hiking, lock your screen and pocket
            your phone. Spatial GPS triggers ambient naturalist vignettes
            directly into your earbuds.
          </p>
        </div>
      </div>

      {errorMessage && (
        <div
          style={{
            background: "#3e1616",
            border: "1px solid #7f1d1d",
            color: "#fca5a5",
            padding: "0.85rem",
            borderRadius: "12px",
            marginBottom: "1rem",
            fontSize: "0.85rem",
          }}
        >
          {errorMessage}
        </div>
      )}

      {/* STATE 1: PREPARATION & UPLOAD */}
      {appState === "prep" && (
        <div className="card">
          <div className="card-title">
            <span>1. Choose Trail Setup</span>
          </div>

          {/* 1-CLICK CURATED SAMPLE TRAILS (FEATURED FOR JUDGES & CONTRIBUTORS) */}
          <SampleTrailsSelector onLoadBundleFile={handleLoadSampleTrail} />

          <div
            style={{
              textAlign: "center",
              margin: "0.25rem 0 1rem 0",
              color: "#64748b",
              fontSize: "0.78rem",
              fontWeight: 700,
              letterSpacing: "0.04em",
            }}
          >
            ── OR LOAD CUSTOM TOURS ──
          </div>

          {/* PATHWAY 1: IMPORT PRE-GENERATED BUNDLE (100% OFFLINE) */}
          <div
            style={{
              background: "rgba(74, 222, 128, 0.05)",
              border: "1px solid #285438",
              borderRadius: "12px",
              padding: "1.1rem",
              marginBottom: "1.25rem",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                marginBottom: "0.35rem",
              }}
            >
              <Archive size={18} color="#4ade80" />
              <strong style={{ color: "#fff", fontSize: "0.95rem" }}>
                Import Trail Bundle (.zip)
              </strong>
              <span
                style={{
                  fontSize: "0.65rem",
                  background: "rgba(74, 222, 128, 0.2)",
                  color: "#4ade80",
                  padding: "2px 6px",
                  borderRadius: "10px",
                  fontWeight: 700,
                }}
              >
                100% OFFLINE
              </span>
            </div>
            <p
              style={{
                fontSize: "0.8rem",
                color: "#94a3b8",
                margin: "0 0 0.85rem 0",
                lineHeight: 1.4,
              }}
            >
              Instantly unpack an already generated tour bundle in the browser
              with zero network calls. Ideal for mobile hiking.
            </p>
            <input
              type="file"
              ref={zipInputRef}
              accept=".zip,application/zip,application/x-zip-compressed"
              style={{ display: "none" }}
              onChange={handleZipInputChange}
            />
            <button
              className="btn btn-secondary"
              onClick={() => zipInputRef.current?.click()}
              style={{ width: "100%", borderColor: "#4ade80" }}
            >
              <FileDown size={18} color="#4ade80" />
              Import Trail Bundle (.zip)
            </button>
          </div>

          <div
            style={{
              textAlign: "center",
              margin: "0.5rem 0 1rem 0",
              color: "#64748b",
              fontSize: "0.78rem",
              fontWeight: 600,
            }}
          >
            ── OR CREATE NEW FROM GPX ──
          </div>

          {/* PATHWAY 2: CREATE NEW TRAIL (.gpx) */}
          <div
            className="upload-zone"
            onClick={() => gpxInputRef.current?.click()}
            onDragOver={(e: React.DragEvent<HTMLDivElement>) =>
              e.preventDefault()
            }
            onDrop={(e: React.DragEvent<HTMLDivElement>) => {
              e.preventDefault();
              const file = e.dataTransfer.files?.[0];
              if (file) {
                if (file.name.toLowerCase().endsWith(".zip")) {
                  handleImportZipBundle(file);
                } else if (file.name.toLowerCase().endsWith(".gpx")) {
                  handleGpxUpload(file);
                } else {
                  alert(
                    "Please select a valid .gpx track or .zip tour bundle.",
                  );
                }
              }
            }}
          >
            <input
              type="file"
              ref={gpxInputRef}
              accept=".gpx,application/gpx+xml"
              style={{ display: "none" }}
              onChange={handleGpxInputChange}
            />
            <div className="upload-icon">
              <UploadCloud size={34} />
            </div>
            <h4>
              {gpxData ? "Custom GPX Track Loaded" : "Create New Trail (.gpx)"}
            </h4>
            <p>
              {gpxData
                ? `Selected: ${trailName} (${(gpxData.length / 1024).toFixed(1)} KB)`
                : "Upload a GPS route file to generate fresh AI narration & audio"}
            </p>
          </div>

          <div
            style={{
              textAlign: "center",
              margin: "0.65rem 0",
              color: "#94a3b8",
              fontSize: "0.8rem",
            }}
          >
            — OR QUICK TEST WITH SAMPLE ROUTE —
          </div>

          <button className="btn btn-secondary" onClick={handleLoadSample}>
            <MapPin size={18} color="#4ade80" />
            Load Sample: Muir Woods Redwood Trail (CA)
          </button>

          <div className="btn-group" style={{ marginTop: "0.85rem" }}>
            <button
              className="btn btn-primary btn-large"
              onClick={handleGenerateBundle}
            >
              Generate Trail Bundle
            </button>
          </div>
        </div>
      )}

      {/* STATE 2: GENERATING BUNDLE */}
      {appState === "generating" && (
        <div className="card">
          <div className="card-title">
            <span>Orchestrating Nature Tour</span>
            <Radio size={18} color="#4ade80" className="animate-spin" />
          </div>

          <div className="progress-container">
            <div className="progress-header">
              <span>{genStage}</span>
              <span>{genProgress}%</span>
            </div>
            <div className="progress-bar-bg">
              <div
                className="progress-bar-fill"
                style={{ width: `${genProgress}%` }}
              />
            </div>

            <div className="progress-stages">
              <div
                className={`stage-item ${genProgress >= 20 ? "done" : "active"}`}
              >
                <CheckCircle2 size={16} /> GPX coordinate parsing & waypoint
                extraction
              </div>
              <div
                className={`stage-item ${genProgress >= 40 ? "done" : genProgress >= 20 ? "active" : ""}`}
              >
                <CheckCircle2 size={16} /> OpenStreetMap Overpass landmark POI
                queries (400m)
              </div>
              <div
                className={`stage-item ${genProgress >= 65 ? "done" : genProgress >= 40 ? "active" : ""}`}
              >
                <CheckCircle2 size={16} /> Gemma 2 sensory field naturalist
                vignettes (45–60 words)
              </div>
              <div
                className={`stage-item ${genProgress >= 85 ? "done" : genProgress >= 65 ? "active" : ""}`}
              >
                <CheckCircle2 size={16} /> ElevenLabs voice synthesis & pure PCM
                WAV fallback
              </div>
              <div
                className={`stage-item ${genProgress >= 95 ? "done" : genProgress >= 85 ? "active" : ""}`}
              >
                <CheckCircle2 size={16} /> In-memory ZIP packaging & IndexedDB
                storage
              </div>
            </div>
          </div>
        </div>
      )}

      {/* STATE 3: READY TO HIKE & AUDIO PREVIEW CONTROLS */}
      {appState === "ready" && manifest && (
        <div className="card">
          <div className="card-title">
            <span>2. Tour Cached & Ready</span>
            <span
              style={{ fontSize: "0.78rem", color: "#4ade80", fontWeight: 700 }}
            >
              ✓ 100% Offline
            </span>
          </div>

          <div style={{ marginBottom: "1.25rem" }}>
            <h2
              style={{
                fontSize: "1.25rem",
                color: "#fff",
                marginBottom: "0.2rem",
              }}
            >
              {manifest.trail_name}
            </h2>
            <div
              style={{
                display: "flex",
                gap: "1rem",
                color: "#86efac",
                fontSize: "0.85rem",
              }}
            >
              <span> {manifest.total_distance_km.toFixed(2)} km</span>
              <span> {manifest.waypoints.length} Trigger Stops</span>
              <span> ~1.5 - 2 hrs</span>
            </div>
          </div>

          {/* Primary Outdoor Action Button */}
          <div className="btn-group" style={{ marginBottom: "1.5rem" }}>
            <button
              className="btn btn-primary btn-large"
              onClick={handleStartHiking}
            >
              <Headphones size={22} />
              Start Walk
            </button>
            <p
              style={{
                fontSize: "0.78rem",
                color: "#94a3b8",
                textAlign: "center",
                marginTop: "2px",
              }}
            >
              Puts app into background GPS pocket mode with MediaSession earbud
              controls.
            </p>
          </div>

          {/* DEDICATED AUDIO TOUR PREVIEW SECTION */}
          <div className="preview-section">
            <div className="preview-header">
              <span
                style={{
                  fontSize: "0.92rem",
                  fontWeight: 800,
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <Volume2 size={17} color="#38bdf8" /> Waypoint Audio Tour
                Preview
              </span>
              <span className="preview-badge">
                Desktop Test & Audio Preview
              </span>
            </div>

            {/* Active Status Banner */}
            <div
              className={`preview-status-banner ${currentlyPlayingId ? "active" : ""}`}
            >
              <div className="preview-status-text">
                {currentlyPlayingId ? (
                  <div className="preview-equalizer">
                    <span></span>
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                ) : (
                  <Volume2 size={16} color="#94a3b8" />
                )}
                <span>{previewStatus}</span>
              </div>
              {currentlyPlayingId && (
                <button className="btn-stop-audio" onClick={handleStopAudio}>
                  <Square size={13} fill="currentColor" /> Stop Audio
                </button>
              )}
            </div>

            {/* Waypoint Preview Cards */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.85rem",
              }}
            >
              {manifest.waypoints.map((wp: WaypointTrigger, idx: number) => {
                const isPlayingThis = currentlyPlayingId === wp.id;
                const distanceMeters = spatialState.currentPosition
                  ? calculateDistanceMeters(
                      spatialState.currentPosition.lat,
                      spatialState.currentPosition.lon,
                      wp.lat,
                      wp.lon,
                    )
                  : null;

                return (
                  <div
                    key={wp.id}
                    className={`waypoint-card ${isPlayingThis ? "is-playing" : ""}`}
                  >
                    <div className="waypoint-card-header">
                      <div className="waypoint-title-group">
                        <div className="waypoint-step-pill">{idx + 1}</div>
                        <div>
                          <div className="waypoint-card-title">{wp.name}</div>
                          <div className="waypoint-badges">
                            <span className="badge-pill">
                              {wp.lat.toFixed(4)}, {wp.lon.toFixed(4)}
                            </span>
                            <span className="badge-pill">
                              {wp.trigger_radius_meters}m trigger
                            </span>
                            {distanceMeters !== null && (
                              <span className="badge-pill badge-distance">
                                {distanceMeters}m away
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    {wp.transcript && (
                      <div className="waypoint-transcript">
                        "{wp.transcript}"
                      </div>
                    )}

                    <button
                      className={`btn-preview-play ${isPlayingThis ? "playing" : ""}`}
                      onClick={() => void handleManualPlay(wp)}
                    >
                      {isPlayingThis ? (
                        <>
                          <Pause size={16} fill="currentColor" /> Pause Preview
                        </>
                      ) : (
                        <>
                          <Play size={16} fill="currentColor" /> Play Preview
                        </>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Secondary Backup & Reset Actions */}
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "1.25rem" }}>
            {zipBlob && (
              <button
                className="btn btn-secondary"
                onClick={handleDownloadZip}
                style={{ flex: 1 }}
              >
                <FileDown size={16} /> Backup ZIP
              </button>
            )}
            <button
              className="btn btn-secondary"
              onClick={handleResetTour}
              style={{ flex: 1 }}
            >
              <RotateCcw size={16} /> New Trail
            </button>
          </div>
        </div>
      )}

      {/* STATE 4: POCKET MODE / ACTIVE HIKE HUD */}
      {appState === "hiking" && (
        <div className="pocket-mode">
          <div className="screen-off-prompt">
            <div className="radar-circle">
              <Radio size={40} />
            </div>
            <h2>Put Phone in Your Pocket</h2>
            <p>
              TrailPulse is monitoring GPS in the background. Audio vignettes
              trigger automatically through your earbuds within 40m of
              landmarks.
            </p>

            <div
              style={{
                marginTop: "1rem",
                display: "flex",
                justifyContent: "center",
              }}
            >
              <div className="earbud-pill">
                <Headphones size={16} color="#4ade80" />
                <span>MediaSession & Bluetooth Earbuds Active</span>
              </div>
            </div>
          </div>

          {/* STICKY LIVE GPS DEBUG HUD */}
          <div className="debug-hud">
            <div className="hud-header">
              <div className="hud-title-badge">
                <span className="hud-live-dot" />
                <span className="hud-title-text">GPS LIVE DEBUG HUD</span>
              </div>
              <div
                className={`hud-status-indicator ${
                  spatialState.isPlaying
                    ? "status-playing"
                    : spatialState.isTriggered
                      ? "status-triggered"
                      : spatialState.isTargetCompleted
                        ? "status-completed"
                        : "status-monitoring"
                }`}
              >
                {spatialState.isPlaying
                  ? " STATUS: PLAYING AUDIO"
                  : spatialState.isTriggered
                    ? " STATUS: TRIGGERED"
                    : spatialState.isTargetCompleted
                      ? " STATUS: TOUR COMPLETED"
                      : " STATUS: MONITORING"}
              </div>
            </div>

            <div className="hud-grid">
              <div className="hud-tile">
                <div className="hud-label">Current GPS</div>
                <div className="hud-val">
                  {spatialState.currentPosition
                    ? `${spatialState.currentPosition.lat.toFixed(5)}, ${spatialState.currentPosition.lon.toFixed(5)}`
                    : "Acquiring GPS fix..."}
                </div>
                <div className="hud-sub">
                  Accuracy:{" "}
                  {spatialState.accuracyMeters !== null
                    ? `±${spatialState.accuracyMeters}m`
                    : "Detecting..."}
                </div>
              </div>

              <div className="hud-tile">
                <div className="hud-label">Target Waypoint</div>
                <div className="hud-val hud-highlight">
                  {spatialState.targetWaypoint
                    ? spatialState.targetWaypoint.name
                    : spatialState.nearestWaypoint
                      ? spatialState.nearestWaypoint.name
                      : spatialState.isTargetCompleted
                        ? "All Trail Stops Visited"
                        : "Searching..."}
                </div>
                <div className="hud-sub">
                  {spatialState.targetWaypoint
                    ? `${spatialState.targetWaypoint.lat.toFixed(5)}, ${spatialState.targetWaypoint.lon.toFixed(5)}`
                    : spatialState.nearestWaypoint
                      ? `${spatialState.nearestWaypoint.lat.toFixed(5)}, ${spatialState.nearestWaypoint.lon.toFixed(5)}`
                      : spatialState.isTargetCompleted
                        ? "Tour sequence finished"
                        : "Awaiting fix"}
                </div>
              </div>

              <div className="hud-tile">
                <div className="hud-label">Distance to Target</div>
                <div
                  className={`hud-val ${spatialState.isTriggered ? "hud-val-triggered" : ""}`}
                >
                  {spatialState.distanceToTargetMeters !== null
                    ? `${spatialState.distanceToTargetMeters}m`
                    : spatialState.distanceToNearestMeters !== null
                      ? `${spatialState.distanceToNearestMeters}m`
                      : "--"}
                </div>
                <div className="hud-sub">
                  {spatialState.isTriggered
                    ? "Target Reached (Inside Zone)"
                    : spatialState.isTargetCompleted
                      ? "All Trail Stops Visited"
                      : `Approaching (Triggers at ≤ ${spatialState.triggerRadiusMeters || 40}m)`}
                </div>
              </div>

              <div className="hud-tile">
                <div className="hud-label">Trigger Radius</div>
                <div className="hud-val">
                  {spatialState.triggerRadiusMeters || 40}m
                </div>
                <div className="hud-sub">
                  {spatialState.isTriggered
                    ? "Inside Trigger Zone"
                    : "Awaiting approach"}
                </div>
              </div>
            </div>

            <div className="hud-button-row">
              <button
                type="button"
                className="btn-hud-force"
                onClick={() => void handleForcePlayNearest()}
                title="Verify cached audio exists in IndexedDB and plays through phone speakers"
              >
                <Volume2 size={16} /> Force Play Waypoint Audio
              </button>
              {spatialState.isSimulating && (
                <button
                  type="button"
                  className="btn-hud-resume"
                  onClick={() => engineRef.current?.resumeSatelliteGPS()}
                  title="Return to real outdoor satellite GPS tracking"
                >
                  <Navigation size={14} /> Resume Satellite GPS
                </button>
              )}
            </div>
          </div>

          {/* Currently Playing / Last Triggered Story Card */}
          {manifest &&
            (spatialState.currentPlayingWaypoint ||
              (isPlayingTestAudio && manifest.waypoints.length > 0)) && (
              <div className="now-playing-card">
                <div className="tag">
                  <Volume2 size={15} /> Now Playing into Earbuds
                </div>
                <h3>
                  {spatialState.currentPlayingWaypoint?.name ||
                    (manifest.waypoints.find(
                      (w: WaypointTrigger) => w.id === currentlyPlayingId,
                    )?.name ??
                      manifest.waypoints[0]?.name)}
                </h3>
                <p>
                  "
                  {spatialState.currentPlayingWaypoint?.transcript ||
                    (manifest.waypoints.find(
                      (w: WaypointTrigger) => w.id === currentlyPlayingId,
                    )?.transcript ??
                      manifest.waypoints[0]?.transcript)}
                  "
                </p>
                <div
                  style={{
                    marginTop: "0.75rem",
                    display: "flex",
                    gap: "0.5rem",
                  }}
                >
                  <button
                    className="btn btn-secondary"
                    style={{
                      width: "auto",
                      padding: "0.4rem 0.8rem",
                      fontSize: "0.8rem",
                    }}
                    onClick={handleStopAudio}
                  >
                    <Pause size={14} /> Pause Audio
                  </button>
                </div>
              </div>
            )}

          {/* Control Buttons */}
          <div
            style={{
              width: "100%",
              display: "flex",
              gap: "0.5rem",
              flexWrap: "wrap",
            }}
          >
            <button
              className={`btn ${isPlayingTestAudio ? "btn-primary" : "btn-secondary"}`}
              onClick={handleTestPlayAudio}
              style={{ flex: 1, minWidth: "105px" }}
            >
              {isPlayingTestAudio ? (
                <>
                  <Pause size={16} /> Pause Audio
                </>
              ) : (
                <>
                  <Play size={16} /> Play Audio
                </>
              )}
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => {
                if (manifest?.waypoints?.[0]) {
                  void handleManualPlay(manifest.waypoints[0]);
                }
              }}
              style={{ flex: 1, minWidth: "105px" }}
            >
              <Volume2 size={16} /> Test Earbuds
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => setShowSimPanel(!showSimPanel)}
              style={{ flex: 1, minWidth: "105px" }}
            >
              <Navigation size={16} /> GPS Simulator
            </button>
          </div>

          {/* Virtual Hiker / GPS Simulator Panel */}
          {showSimPanel && manifest && (
            <div className="sim-panel">
              <h4>
                <Navigation size={14} /> Hackathon GPS Simulator (Virtual Hiker)
              </h4>
              <p
                style={{
                  fontSize: "0.75rem",
                  color: "#cbd5e1",
                  marginBottom: "0.75rem",
                }}
              >
                Teleport virtual GPS near waypoints to verify spatial geofences
                (40m) and MediaSession playback:
              </p>
              <div className="sim-buttons">
                {manifest.waypoints.map((wp: WaypointTrigger, idx: number) => (
                  <button
                    key={wp.id}
                    className="sim-btn"
                    onClick={() => {
                      engineRef.current?.simulatePosition(
                        wp.lat + 0.00008,
                        wp.lon + 0.00008,
                        3,
                      );
                    }}
                  >
                    Step to #{idx + 1}: {wp.name.slice(0, 18)}...
                  </button>
                ))}
              </div>
            </div>
          )}

          <button
            className="btn btn-secondary"
            onClick={handleExitHiking}
            style={{ width: "100%", borderColor: "#475569", color: "#94a3b8" }}
          >
            End Hike & Return to Summary
          </button>
        </div>
      )}

      {/* Footer */}
      <footer className="app-footer">
        <p>TrailPulse • Built for Hacktoberfest 2026 "Touch Grass" Challenge</p>
        <p style={{ marginTop: "0.2rem" }}>
          Zero Cloud Outdoors • Open-Weights Gemma 2 • ElevenLabs
        </p>
      </footer>
    </div>
  );
}
