// components/formation/FormationViewer.tsx
import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ViewControls, VIEW_CONFIGURATIONS } from './ViewControls';
import { Stack, Select, Button, Group, Slider, Text, SegmentedControl } from '@mantine/core';
import { IconPlayerPlay, IconPlayerPause } from '@tabler/icons-react';
import { projectFormationAtTime } from '../../lib/formation/coordinates';
import type { AltitudeMode, ParticipantData, ProjectedPosition } from '../../lib/formation/coordinates';
import type { GeodeticCoordinates } from '../../lib/formation/types';
import { createHumanoidMesh, disposeHumanoidMesh } from './HumanoidMesh';

export interface FormationData {
  id: string;
  startTime: Date;
  baseJumperId: string;
  jumpRunTrack_degTrue: number;
  participants: ParticipantData[];
  dzElevation_m?: number;
  timelineStart?: number;
  timelineEnd?: number;
}

interface FormationViewerProps {
  formation: FormationData;
  dzCenter: GeodeticCoordinates;
  altitudeMode: AltitudeMode;
  onAltitudeModeChange?: (mode: AltitudeMode) => void;
  onBaseChange?: (newBaseId: string) => void;
  onTimeChange?: (time: number) => void;
}

// ─── helpers ────────────────────────────────────────────────────

function getTimelineBounds(formation: FormationData) {
  const allTimes = formation.participants.flatMap(p =>
    p.timeSeries.map(ts => ts.timeOffset)
  );
  const dataMin = allTimes.length > 0 ? Math.min(...allTimes) : 0;
  const dataMax = allTimes.length > 0 ? Math.max(...allTimes) : 0;

  return {
    min: formation.timelineStart ?? dataMin,
    max: formation.timelineEnd ?? dataMax,
  };
}

/**
 * Fixed mapping from Base Exit Frame to Three.js world coordinates.
 *
 *   Base Frame        Three.js
 *   x (forward)  →    X
 *   y (right)    →    Z
 *   z (down)     →   -Y   (Three.js Y is up)
 *
 * Applied once — view changes are handled entirely by camera placement.
 */
function baseFrameToWorld(pos: { x: number; y: number; z: number }): THREE.Vector3 {
  return new THREE.Vector3(pos.x, -pos.z, pos.y);
}

// ─── component ──────────────────────────────────────────────────

export const FormationViewer: React.FC<FormationViewerProps> = ({
  formation,
  dzCenter,
  altitudeMode,
  onAltitudeModeChange,
  onBaseChange,
  onTimeChange,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);

  // Three.js objects stored in a single ref to avoid stale-closure issues
  const threeRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    controls: OrbitControls;
    grid: THREE.GridHelper;
    axes: THREE.AxesHelper;
    frameId: number;
    jumperMeshes: Map<string, THREE.Group>;
    trailLines: Map<string, THREE.Line>;
    disposed: boolean;
  } | null>(null);

  const hasAutoScaled = useRef(false);

  const bounds = getTimelineBounds(formation);

  // ── state ──
  const [currentTime, setCurrentTime] = useState(bounds.min);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [viewMode, setViewMode] = useState<string>('godsEye');
  const [showTrails, setShowTrails] = useState(true);
  const [trailLength, setTrailLength] = useState(3);
  const [baseJumperId, setBaseJumperId] = useState(formation.baseJumperId);
  const [showGrid, setShowGrid] = useState(true);
  const [showAxes, setShowAxes] = useState(true);

  // ── scene initialisation ──
  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;

    const width = el.clientWidth;
    const height = el.clientHeight || 600;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x002233);

    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 50000);
    camera.position.set(0, 200, 0); // default: god's eye
    camera.up.set(-1, 0, 0);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    el.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxDistance = 5000;
    controls.minDistance = 5;

    // Grid in XZ plane (forward/right ground plane)
    const grid = new THREE.GridHelper(200, 20, 0x444444, 0x222222);
    scene.add(grid);

    const axes = new THREE.AxesHelper(50);
    scene.add(axes);

    // Lighting
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.4);
    dirLight.position.set(100, 100, 50);
    scene.add(dirLight);

    // Store everything in a single ref
    const ctx = {
      scene,
      camera,
      renderer,
      controls,
      grid,
      axes,
      frameId: 0,
      jumperMeshes: new Map<string, THREE.Group>(),
      trailLines: new Map<string, THREE.Line>(),
      disposed: false,
    };
    threeRef.current = ctx;
    hasAutoScaled.current = false;

    // Render loop
    const animate = () => {
      if (ctx.disposed) return;
      ctx.frameId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // Resize handler
    const onResize = () => {
      if (!el || ctx.disposed) return;
      const w = el.clientWidth;
      const h = el.clientHeight || 600;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    console.log('[FormationViewer] Scene initialised');

    // Cleanup (handles React Strict Mode double-mount)
    return () => {
      console.log('[FormationViewer] Cleaning up scene');
      ctx.disposed = true;
      cancelAnimationFrame(ctx.frameId);
      window.removeEventListener('resize', onResize);

      // Remove all created meshes and lines from scene, dispose GPU resources
      ctx.jumperMeshes.forEach(group => {
        scene.remove(group);
        disposeHumanoidMesh(group);
      });
      ctx.jumperMeshes.clear();

      ctx.trailLines.forEach(line => {
        scene.remove(line);
        line.geometry.dispose();
        (line.material as THREE.Material).dispose();
      });
      ctx.trailLines.clear();

      controls.dispose();
      renderer.dispose();
      el.removeChild(renderer.domElement);

      threeRef.current = null;
    };
  }, []); // mount once

  // ── project positions & update meshes ──
  useEffect(() => {
    const ctx = threeRef.current;
    if (!ctx || ctx.disposed) return;

    let positions: ProjectedPosition[];
    try {
      positions = projectFormationAtTime(
        formation.participants,
        currentTime,
        baseJumperId,
        dzCenter,
        altitudeMode,
        formation.jumpRunTrack_degTrue,
      );
    } catch (err) {
      console.error('[FormationViewer] Projection error:', err);
      return;
    }

    for (const pos of positions) {
      let group = ctx.jumperMeshes.get(pos.userId);

      if (!group) {
        // Create humanoid figure
        group = createHumanoidMesh(pos.color);
        ctx.scene.add(group);
        ctx.jumperMeshes.set(pos.userId, group);

        // Name label sprite (attached above the figure)
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 64;
        const c2d = canvas.getContext('2d');
        if (c2d) {
          c2d.font = '24px Arial';
          c2d.fillStyle = pos.color;
          c2d.textAlign = 'center';
          c2d.fillText(pos.name, 128, 40);
        }
        const tex = new THREE.CanvasTexture(canvas);
        const sprite = new THREE.Sprite(
          new THREE.SpriteMaterial({ map: tex, transparent: true }),
        );
        sprite.scale.set(20, 5, 1);
        sprite.position.y = 5;
        group.add(sprite);

        console.log(`[FormationViewer] Created humanoid for ${pos.name}`);
      }

      // Place directly in world coordinates — no per-view transformation
      group.position.copy(baseFrameToWorld(pos.position));

      // Apply orientation quaternion if available
      if (pos.orientation_q) {
        group.quaternion.set(
          pos.orientation_q.x,
          pos.orientation_q.y,
          pos.orientation_q.z,
          pos.orientation_q.w
        );
      }

      // Adjust opacity for data gaps
      group.traverse(child => {
        if (child instanceof THREE.Mesh) {
          (child.material as THREE.MeshPhongMaterial).opacity = pos.isDataGap ? 0.5 : 0.9;
        }
      });
    }

    // ── auto-scale camera on first valid projection ──
    if (!hasAutoScaled.current && positions.length > 0) {
      hasAutoScaled.current = true;

      let maxDist = 0;
      for (const pos of positions) {
        const wp = baseFrameToWorld(pos.position);
        maxDist = Math.max(maxDist, wp.length());
      }

      const viewRadius = Math.max(maxDist * 2.5, 50);
      const config = VIEW_CONFIGURATIONS[viewMode];
      if (config) {
        const configDist = Math.sqrt(
          config.cameraPosition.x ** 2 +
          config.cameraPosition.y ** 2 +
          config.cameraPosition.z ** 2
        );
        const scale = viewRadius / configDist;
        ctx.camera.position.set(
          config.cameraPosition.x * scale,
          config.cameraPosition.y * scale,
          config.cameraPosition.z * scale,
        );
        ctx.camera.up.set(config.cameraUp.x, config.cameraUp.y, config.cameraUp.z);
      }
      ctx.camera.lookAt(0, 0, 0);
      ctx.controls.target.set(0, 0, 0);
      ctx.controls.update();

      // Scale grid proportionally
      const s = Math.max(viewRadius * 2, 200) / 200;
      ctx.grid.scale.set(s, s, s);

      console.log(
        `[FormationViewer] Auto-scaled: maxDist=${maxDist.toFixed(1)}m, viewRadius=${viewRadius.toFixed(0)}m`,
      );
    }
  }, [formation, currentTime, viewMode, baseJumperId, dzCenter, altitudeMode]);

  // ── trails ──
  useEffect(() => {
    const ctx = threeRef.current;
    if (!ctx || ctx.disposed) return;

    if (!showTrails) {
      ctx.trailLines.forEach(line => ctx.scene.remove(line));
      return;
    }

    const trailStart = Math.max(bounds.min, currentTime - trailLength);
    const trailEnd = currentTime;
    const steps = Math.max(Math.ceil((trailEnd - trailStart) * 4), 1);

    for (const participant of formation.participants) {
      if (!participant.isVisible) continue;

      const points: THREE.Vector3[] = [];
      for (let i = 0; i <= steps; i++) {
        const t = trailStart + (i / steps) * (trailEnd - trailStart);
        try {
          const projected = projectFormationAtTime(
            formation.participants,
            t,
            baseJumperId,
            dzCenter,
            altitudeMode,
            formation.jumpRunTrack_degTrue,
          );
          const p = projected.find(pp => pp.userId === participant.userId);
          if (p) points.push(baseFrameToWorld(p.position));
        } catch {
          // skip
        }
      }

      if (points.length > 1) {
        let line = ctx.trailLines.get(participant.userId);
        if (!line) {
          const mat = new THREE.LineBasicMaterial({
            color: new THREE.Color(participant.color),
            opacity: 0.5,
            transparent: true,
          });
          line = new THREE.Line(new THREE.BufferGeometry(), mat);
          ctx.scene.add(line);
          ctx.trailLines.set(participant.userId, line);
        } else {
          line.geometry.dispose();
          line.geometry = new THREE.BufferGeometry();
        }
        line.geometry.setFromPoints(points);
      }
    }
  }, [formation, currentTime, showTrails, trailLength, baseJumperId, dzCenter, altitudeMode, bounds.min]);

  // ── view mode changes → camera position & up only ──
  useEffect(() => {
    const ctx = threeRef.current;
    if (!ctx || ctx.disposed) return;
    const config = VIEW_CONFIGURATIONS[viewMode];
    if (!config) return;

    ctx.camera.position.set(
      config.cameraPosition.x,
      config.cameraPosition.y,
      config.cameraPosition.z,
    );
    ctx.camera.up.set(
      config.cameraUp.x,
      config.cameraUp.y,
      config.cameraUp.z,
    );
    ctx.controls.target.set(0, 0, 0);
    ctx.controls.update();

    // Reset auto-scale so camera re-fits on view change
    hasAutoScaled.current = false;
  }, [viewMode]);

  // ── grid / axes visibility ──
  useEffect(() => {
    const ctx = threeRef.current;
    if (!ctx || ctx.disposed) return;
    ctx.grid.visible = showGrid;
    ctx.axes.visible = showAxes;
  }, [showGrid, showAxes]);

  // ── notify parent of time changes ──
  useEffect(() => {
    onTimeChange?.(currentTime);
  }, [currentTime]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── playback animation ──
  useEffect(() => {
    if (!isPlaying) return;
    let lastTs: number | null = null;
    let raf: number;

    const tick = (ts: number) => {
      if (lastTs !== null) {
        const dt = (ts - lastTs) / 1000;
        setCurrentTime(prev => {
          const next = prev + dt * playbackSpeed;
          if (next >= bounds.max) {
            setIsPlaying(false);
            return bounds.max;
          }
          return next;
        });
      }
      lastTs = ts;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, playbackSpeed, bounds.max]);

  // ── event handlers ──
  const handleTimeChange = (value: number) => {
    setCurrentTime(value);
    setIsPlaying(false);
  };

  const handleBaseChange = (value: string | null) => {
    if (!value) return;
    setBaseJumperId(value);
    onBaseChange?.(value);
    hasAutoScaled.current = false;
  };

  // ── render ──
  return (
    <Stack gap="md" style={{ width: '100%' }}>
      {/* 3D viewport */}
      <div
        ref={mountRef}
        style={{
          width: '100%',
          height: '600px',
          border: '1px solid #444',
          borderRadius: '8px',
          overflow: 'hidden',
        }}
      />

      {/* View controls */}
      <ViewControls currentView={viewMode} onViewChange={setViewMode} />

      {/* Display toggles */}
      <Group>
        <Button variant={showGrid ? 'filled' : 'outline'} size="sm" onClick={() => setShowGrid(v => !v)}>
          Grid
        </Button>
        <Button variant={showAxes ? 'filled' : 'outline'} size="sm" onClick={() => setShowAxes(v => !v)}>
          Axes
        </Button>
        <Text size="sm" fw={500}>Altitude:</Text>
        <SegmentedControl
          value={altitudeMode}
          onChange={v => onAltitudeModeChange?.(v as AltitudeMode)}
          data={[
            { label: 'Barometric', value: 'Barometric' },
            { label: 'GPS', value: 'GPS' },
          ]}
          size="sm"
        />
      </Group>

      {/* Playback */}
      <Group>
        <Button onClick={() => setIsPlaying(p => !p)} variant="filled">
          {isPlaying ? <IconPlayerPause style={{ marginRight: 8 }} /> : <IconPlayerPlay style={{ marginRight: 8 }} />}
          {isPlaying ? 'Pause' : 'Play'}
        </Button>

        <Select
          value={playbackSpeed.toString()}
          onChange={v => v && setPlaybackSpeed(parseFloat(v))}
          data={[
            { value: '0.25', label: '0.25x' },
            { value: '0.5', label: '0.5x' },
            { value: '1', label: '1x' },
            { value: '2', label: '2x' },
            { value: '4', label: '4x' },
          ]}
          style={{ width: 100 }}
        />

        <Text size="sm">Base:</Text>
        <Select
          value={baseJumperId}
          onChange={handleBaseChange}
          data={formation.participants.map(p => ({ value: p.userId, label: p.name }))}
          style={{ width: 200 }}
        />
      </Group>

      {/* Time slider */}
      <Group style={{ width: '100%' }}>
        <Text size="sm" style={{ minWidth: 60 }}>
          {currentTime.toFixed(1)}s
        </Text>
        <Slider
          value={currentTime}
          onChange={handleTimeChange}
          min={bounds.min}
          max={bounds.max}
          step={0.1}
          style={{ flex: 1 }}
          label={v => `${v.toFixed(1)}s`}
        />
        <Text size="sm" style={{ minWidth: 60 }}>
          {bounds.max.toFixed(1)}s
        </Text>
      </Group>

      {/* Trail controls */}
      <Group>
        <Button variant={showTrails ? 'filled' : 'outline'} onClick={() => setShowTrails(v => !v)}>
          Trails
        </Button>
        {showTrails && (
          <>
            <Text size="sm">Length:</Text>
            <Slider
              value={trailLength}
              onChange={setTrailLength}
              min={1}
              max={10}
              step={0.5}
              style={{ width: 200 }}
              label={v => `${v}s`}
            />
          </>
        )}
      </Group>
    </Stack>
  );
};
