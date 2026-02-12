// components/formation/FormationViewer.tsx
import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { ViewControls, VIEW_CONFIGURATIONS, ViewConfiguration } from './ViewControls';
import { Stack, Select, Button, Group, Badge, Slider, Text } from '@mantine/core';
import { IconPlayerPlay, IconPlayerPause, IconPlayerSkipForward } from '@tabler/icons-react';
import { projectFormationAtTime } from '../../lib/formation/coordinates';
import type { ParticipantData, ProjectedPosition } from '../../lib/formation/coordinates';
import type { GeodeticCoordinates } from '../../lib/formation/types';
import { Vector3 } from '../../lib/formation/types';

export interface FormationData {
  id: string;
  startTime: Date;
  baseJumperId: string;
  jumpRunTrack_degTrue: number;
  participants: ParticipantData[];
  dzElevation_m?: number;
}

interface FormationViewerState {
  currentTime: number;
  isPlaying: boolean;
  playbackSpeed: number;
  viewMode: keyof typeof VIEW_CONFIGURATIONS;
  showTrails: boolean;
  trailLength: number;
  baseJumperId: string;
  showGrid: boolean;
  showAxes: boolean;
}

interface FormationViewerProps {
  formation: FormationData;
  dzCenter: GeodeticCoordinates;
  onBaseChange?: (newBaseId: string) => void;
  onTimeChange?: (time: number) => void;
}

const createAxisLabels = (scene: THREE.Scene, viewConfig: ViewConfiguration) => {
  const loader = new FontLoader();
  
  // Create text sprites for axis labels
  const createLabel = (text: string, color: string, position: THREE.Vector3) => {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.width = 128;
    canvas.height = 64;
    
    if (context) {
      context.font = 'Bold 20px Arial';
      context.fillStyle = color;
      context.textAlign = 'center';
      context.fillText(text, 64, 40);
    }
    
    const texture = new THREE.CanvasTexture(canvas);
    const spriteMaterial = new THREE.SpriteMaterial({
      map: texture,
      transparent: true
    });
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.position.copy(position);
    sprite.scale.set(10, 5, 1);
    return sprite;
  };
  
  // Remove old labels
  scene.children
    .filter(child => child.userData.isAxisLabel)
    .forEach(child => scene.remove(child));
  
  // Add new labels based on view
  const xLabel = createLabel(viewConfig.labels.x, '#ff0000', new THREE.Vector3(60, 0, 0));
  xLabel.userData.isAxisLabel = true;
  scene.add(xLabel);
  
  const yLabel = createLabel(viewConfig.labels.y, '#00ff00', new THREE.Vector3(0, 60, 0));
  yLabel.userData.isAxisLabel = true;
  scene.add(yLabel);
  
  const zLabel = createLabel(viewConfig.labels.z, '#0000ff', new THREE.Vector3(0, 0, 60));
  zLabel.userData.isAxisLabel = true;
  scene.add(zLabel);
};

export const FormationViewer: React.FC<FormationViewerProps> = ({ 
  formation, 
  dzCenter,
  onBaseChange,
  onTimeChange
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene>(null);
  const rendererRef = useRef<THREE.WebGLRenderer>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera>(null);
  const controlsRef = useRef<OrbitControls>(null);
  const jumperMeshes = useRef<Map<string, THREE.Mesh>>(new Map());
  const trailLines = useRef<Map<string, THREE.Line>>(new Map());
  const frameRef = useRef<number | null>(null);

  const calculateMinTime = () => {
    const times = formation.participants.flatMap(p => 
      p.timeSeries.map(ts => ts.timeOffset)
    );
    return times.length > 0 ? Math.min(...times) : 0;
  };

  const calculateMaxTime = () => {
    const times = formation.participants.flatMap(p => 
      p.timeSeries.map(ts => ts.timeOffset)
    );
    return times.length > 0 ? Math.max(...times) : 0;
  };
  
  useEffect(() => {
    console.log('Formation data loaded:', formation);
    formation.participants.forEach(p => {
      console.log(`${p.name}:`, {
        timeSeriesLength: p.timeSeries.length,
        firstTime: p.timeSeries[0]?.timeOffset,
        lastTime: p.timeSeries[p.timeSeries.length - 1]?.timeOffset,
        //exitOffset: p.jumpData?.exitOffsetSec,
        hasGPSData: p.timeSeries.some(ts => ts.location !== null)
      });
    });
  }, [formation]);

  const [state, setState] = useState<FormationViewerState>({
    currentTime: calculateMinTime(), // Now we can use it
    isPlaying: false,
    playbackSpeed: 1,
    viewMode: 'godsEye',
    showTrails: true,
    trailLength: 3,
    baseJumperId: formation.baseJumperId,
    showGrid: true,
    showAxes: true
  });


  // Grid helper ref for updates
  const gridRef = useRef<THREE.GridHelper>(null);
  const axesRef = useRef<THREE.AxesHelper>(null);

  // Apply view configuration
  const applyViewConfiguration = useCallback((viewKey: string) => {
    const config = VIEW_CONFIGURATIONS[viewKey];
    if (!config || !cameraRef.current || !controlsRef.current || !sceneRef.current) return;

    // Update camera position and target
    cameraRef.current.position.set(
      config.cameraPosition.x,
      config.cameraPosition.y,
      config.cameraPosition.z
    );
    controlsRef.current.target.set(
      config.cameraTarget.x,
      config.cameraTarget.y,
      config.cameraTarget.z
    );
    controlsRef.current.update();

    // Update grid rotation
    if (gridRef.current) {
      gridRef.current.rotation.set(
        config.gridRotation.x,
        config.gridRotation.y,
        config.gridRotation.z
      );
    }

    // Update axis labels
    if (state.showAxes) {
      createAxisLabels(sceneRef.current, config);
    }
  }, [state.showAxes]);

  // Update view when mode changes
  useEffect(() => {
    applyViewConfiguration(state.viewMode);
  }, [state.viewMode, applyViewConfiguration]);

  const transformPositionForView = useCallback((
    position: Vector3,
    viewMode: string
  ): THREE.Vector3 => {
    const config = VIEW_CONFIGURATIONS[viewMode];
    if (!config) return new THREE.Vector3(position.x, position.y, position.z);

    // Map Base Exit Frame coordinates to display coordinates based on view
    switch (viewMode) {
      case 'godsEye':
        // XY plane, Z=0
        return new THREE.Vector3(position.x, position.y, 0);
      
      case 'side':
        // XZ plane (X forward, Z up), Y=0
        return new THREE.Vector3(position.x, -position.z, 0);
      
      case 'trailing':
        // YZ plane (Y right, Z up), X=0
        return new THREE.Vector3(0, position.y, -position.z);
      
      default:
        return new THREE.Vector3(position.x, position.y, position.z);
    }
  }, []);

  // Calculate max time from formation data
  const getMaxTime = useCallback(() => {
    return Math.max(
      ...formation.participants.flatMap(p => 
        p.timeSeries.map(ts => ts.timeOffset)
      )
    );
  }, [formation]);

  // Initialize Three.js scene
  useEffect(() => {
    if (!mountRef.current) return;

    // Scene setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x002233); // Theme background
    scene.fog = new THREE.Fog(0x002233, 200, 1000);
    sceneRef.current = scene;

    // Camera
    const width = mountRef.current.clientWidth;
    const height = mountRef.current.clientHeight;
    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 10000);
    camera.position.set(0, -150, 150);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ 
      antialias: true,
      alpha: true 
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(window.devicePixelRatio);
    mountRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxDistance = 500;
    controls.minDistance = 10;
    controlsRef.current = controls;

    // Grid helper - XY plane for god's eye view
    const gridHelper = new THREE.GridHelper(200, 20, 0x444444, 0x222222);
    gridHelper.rotation.x = Math.PI / 2;
    scene.add(gridHelper);

    // Axis helper
    const axisHelper = new THREE.AxesHelper(50);
    scene.add(axisHelper);

    gridRef.current = gridHelper;
    axesRef.current = axisHelper;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.4);
    directionalLight.position.set(100, 100, 50);
    directionalLight.castShadow = true;
    scene.add(directionalLight);

    // Handle resize
    const handleResize = () => {
      if (!mountRef.current) return;
      const width = mountRef.current.clientWidth;
      const height = mountRef.current.clientHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };
    window.addEventListener('resize', handleResize);

    // Render loop
    const animate = () => {
      frameRef.current = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      window.removeEventListener('resize', handleResize);
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
      mountRef.current?.removeChild(renderer.domElement);
      controls.dispose();
      renderer.dispose();
      
      // Clean up geometries and materials
      jumperMeshes.current.forEach(mesh => {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      });
      trailLines.current.forEach(line => {
        line.geometry.dispose();
        (line.material as THREE.Material).dispose();
      });
    };
  }, []);

  useEffect(() => {
    if (!sceneRef.current) return;

    try {
      const positions = projectFormationAtTime(
        formation.participants,
        state.currentTime,
        state.baseJumperId,
        dzCenter
      );

      console.log('Projected positions at time', state.currentTime, ':', positions);

      positions.forEach(pos => {
        console.log(`Jumper ${pos.name} at:`, pos.position);

        let mesh = jumperMeshes.current.get(pos.userId);

        if (!mesh) {
          // Create new jumper mesh
          const geometry = new THREE.SphereGeometry(2, 16, 16);
          const material = new THREE.MeshPhongMaterial({ 
            color: new THREE.Color(pos.color),
            transparent: true,
            opacity: 0.9,
            emissive: new THREE.Color(pos.color),
            emissiveIntensity: 0.2
          });
          mesh = new THREE.Mesh(geometry, material);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          if (sceneRef.current) {
            sceneRef.current.add(mesh);
          }
          jumperMeshes.current.set(pos.userId, mesh);

          // Add name label (using sprite)
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          canvas.width = 256;
          canvas.height = 64;
          if (context) {
            context.font = '24px Arial';
            context.fillStyle = pos.color;
            context.textAlign = 'center';
            context.fillText(pos.name, 128, 40);
          }
          const texture = new THREE.CanvasTexture(canvas);
          const spriteMaterial = new THREE.SpriteMaterial({ 
            map: texture,
            transparent: true 
          });
          const sprite = new THREE.Sprite(spriteMaterial);
          sprite.scale.set(20, 5, 1);
          sprite.position.y = 5;
          mesh.add(sprite);
        }

        // Transform position based on current view
        const displayPos = transformPositionForView(pos.position, state.viewMode);
        if (mesh) {
          mesh.position.copy(displayPos);

          // Update opacity for data gaps
          const material = mesh.material as THREE.MeshPhongMaterial;
          material.opacity = pos.isDataGap ? 0.5 : 0.9;
        }
      });

    } catch (error) {
      console.error('Error projecting formation:', error);
    }
  }, [formation, state.currentTime, state.viewMode, state.baseJumperId, dzCenter, transformPositionForView]);

  // Update trail rendering for view modes
  const getTrailPoint = useCallback((position: Vector3, viewMode: string): THREE.Vector3 => {
    return transformPositionForView(position, viewMode);
  }, [transformPositionForView]);

  // Handle view mode change
  const handleViewModeChange = (viewKey: string) => {
    if (viewKey in VIEW_CONFIGURATIONS) {
      setState(prev => ({ ...prev, viewMode: viewKey as keyof typeof VIEW_CONFIGURATIONS }));
    }
  };

  // Toggle grid and axes
  const toggleGrid = () => {
    setState(prev => ({ ...prev, showGrid: !prev.showGrid }));
    if (gridRef.current) {
      gridRef.current.visible = !state.showGrid;
    }
  };

  const toggleAxes = () => {
    setState(prev => ({ ...prev, showAxes: !prev.showAxes }));
    if (axesRef.current) {
      axesRef.current.visible = !state.showAxes;
    }
    // Update labels
    if (sceneRef.current && !state.showAxes) {
      sceneRef.current.children
        .filter(child => child.userData.isAxisLabel)
        .forEach(child => sceneRef.current!.remove(child));
    }
  };

  const getMinTime = useCallback(() => {
    const times = formation.participants.flatMap(p => 
      p.timeSeries.map(ts => ts.timeOffset)
    );
    return times.length > 0 ? Math.min(...times) : 0;
  }, [formation]);

  // Update trails
  useEffect(() => {
    if (!sceneRef.current || !state.showTrails) {
      // Remove all trails
      trailLines.current.forEach(line => {
        sceneRef.current?.remove(line);
      });
      return;
    }

    // Calculate trail time range
    const trailStart = Math.max(0, state.currentTime - state.trailLength);
    const trailEnd = state.currentTime;
    const trailSteps = Math.ceil((trailEnd - trailStart) * 4); // 4Hz data

    formation.participants.forEach(participant => {
      if (!participant.isVisible) return;

      const points: THREE.Vector3[] = [];
      
      // Sample trail points
      for (let i = 0; i <= trailSteps; i++) {
        const t = trailStart + (i / trailSteps) * (trailEnd - trailStart);
        try {
          const projected = projectFormationAtTime(
            formation.participants,
            t,
            state.baseJumperId,
            dzCenter
          );
          
          const pos = projected.find(p => p.userId === participant.userId);
          if (pos) {
            const point = transformPositionForView(pos.position, state.viewMode);
            points.push(point);
          }
        } catch (e) {
          // Skip this point
        }
      }

      if (points.length > 1) {
        let line = trailLines.current.get(participant.userId);
        
        if (!line) {
          const geometry = new THREE.BufferGeometry();
          const material = new THREE.LineBasicMaterial({
            color: new THREE.Color(participant.color),
            opacity: 0.5,
            transparent: true
          });
          line = new THREE.Line(geometry, material);
          if (sceneRef.current) {
            sceneRef.current.add(line);
          }
          trailLines.current.set(participant.userId, line);
        } else {
          // Dispose old geometry to avoid buffer size issues
          line.geometry.dispose();
          line.geometry = new THREE.BufferGeometry();
        }

        // Update trail geometry
        line.geometry.setFromPoints(points);
      }
    });
  }, [formation, state.currentTime, state.showTrails, state.trailLength, 
      state.baseJumperId, state.viewMode, dzCenter]);

  // Playback animation
  useEffect(() => {
    if (!state.isPlaying) return;

    let lastTimestamp: number | null = null;
    let animationId: number;

    const animate = (timestamp: number) => {
      if (!lastTimestamp) lastTimestamp = timestamp;
      const deltaTime = (timestamp - lastTimestamp) / 1000;

      // Use a callback to avoid setting state during render
      setState(prev => {
        const newTime = prev.currentTime + (deltaTime * prev.playbackSpeed);
        const maxTime = getMaxTime();
        const minTime = getMinTime(); // Add this function
        
        if (newTime >= maxTime) {
          // Schedule the onTimeChange call after render
          setTimeout(() => onTimeChange?.(maxTime), 0);
          return { ...prev, currentTime: maxTime, isPlaying: false };
        }
        setTimeout(() => onTimeChange?.(newTime), 0);
        return { ...prev, currentTime: newTime };
      });

      lastTimestamp = timestamp;
      animationId = requestAnimationFrame(animate);
    };

    animationId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationId);
  }, [state.isPlaying, state.playbackSpeed, getMaxTime, onTimeChange]);

  // Playback controls
  const togglePlayback = () => {
    setState(prev => ({ ...prev, isPlaying: !prev.isPlaying }));
  };

  const handleTimeChange = (value: number) => {
    setState(prev => ({ ...prev, currentTime: value, isPlaying: false }));
    onTimeChange?.(value); // Call the prop if provided
  };

  const handleSpeedChange = (value: string | null) => {
    if (value) {
      setState(prev => ({ ...prev, playbackSpeed: parseFloat(value) }));
    }
  };

  const handleBaseChange = (value: string | null) => {
    if (value) {
      setState(prev => ({ ...prev, baseJumperId: value }));
      onBaseChange?.(value);
    }
  };

  return (
    <Stack gap="md" style={{ width: '100%', height: '100%' }}>
      {/* 3D Viewport */}
      <div 
        ref={mountRef} 
        style={{ 
          width: '100%', 
          height: '600px',
          position: 'relative',
          border: '1px solid #444',
          borderRadius: '8px',
          overflow: 'hidden'
        }} 
      />

      {/* View Controls */}
      <ViewControls 
        currentView={state.viewMode} 
        onViewChange={handleViewModeChange} 
      />

      {/* Display Options */}
      <Group>
        <Button
          variant={state.showGrid ? 'filled' : 'outline'}
          size="sm"
          onClick={toggleGrid}
        >
          Grid
        </Button>
        <Button
          variant={state.showAxes ? 'filled' : 'outline'}
          size="sm"
          onClick={toggleAxes}
        >
          Axes
        </Button>
      </Group>

      {/* Playback Controls */}
      <Group>
        <Group>
          <Button
            onClick={togglePlayback}
            variant="filled"
          >
            {state.isPlaying ? <IconPlayerPause style={{ marginRight: 8 }} /> : <IconPlayerPlay style={{ marginRight: 8 }} />}
            {state.isPlaying ? 'Pause' : 'Play'}
          </Button>
          
          <Select
            value={state.playbackSpeed.toString()}
            onChange={handleSpeedChange}
            data={[
              { value: '0.25', label: '0.25x' },
              { value: '0.5', label: '0.5x' },
              { value: '1', label: '1x' },
              { value: '2', label: '2x' },
              { value: '4', label: '4x' }
            ]}
            style={{ width: '100px' }}
          />

          <Select
            value={state.viewMode}
            onChange={(value) => {
              if (value) handleViewModeChange(value);
            }}
            data={[
              { value: 'godsEye', label: "God's Eye View" },
              { value: 'side', label: 'Side View' }
            ]}
            style={{ width: '150px' }}
          />
        </Group>

        <Group>
          <Text size="sm">Base:</Text>
          <Select
            value={state.baseJumperId}
            onChange={handleBaseChange}
            data={formation.participants.map(p => ({
              value: p.userId,
              label: p.name
            }))}
            style={{ width: '200px' }}
          />
        </Group>
      </Group>

      {/* Time Slider */}
      <Group style={{ width: '100%' }}>
        <Text size="sm" style={{ minWidth: '60px' }}>
          {state.currentTime.toFixed(1)}s
        </Text>
        <Slider
          value={state.currentTime}
          onChange={handleTimeChange}
          min={getMinTime()}
          max={getMaxTime()}
          step={0.1}
          style={{ flex: 1 }}
          label={(value) => `${value.toFixed(1)}s`}
        />
        <Text size="sm" style={{ minWidth: '60px' }}>
          {getMaxTime().toFixed(1)}s
        </Text>
      </Group>

      {/* Trail Controls */}
      <Group>
        <Button
          variant={state.showTrails ? 'filled' : 'outline'}
          onClick={() => setState(prev => ({ ...prev, showTrails: !prev.showTrails }))}
        >
          Trails
        </Button>
        {state.showTrails && (
          <>
            <Text size="sm">Length:</Text>
            <Slider
              value={state.trailLength}
              onChange={(value) => setState(prev => ({ ...prev, trailLength: value }))}
              min={1}
              max={10}
              step={0.5}
              style={{ width: '200px' }}
              label={(value) => `${value}s`}
            />
          </>
        )}
      </Group>
    </Stack>
  );
};