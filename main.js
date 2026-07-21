import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Configuration & Constants
const GLOBE_RADIUS = 100;
const MIAMI_COORDS = { lat: 25.7933, lng: -80.2906, name: "Miami (MIA)" };
const ROSARIO_COORDS = { lat: -32.9036, lng: -60.7844, name: "Rosario (ROS)" };
const FLIGHT_DISTANCE_KM = 6586; // Approximate Miami to Rosario distance in km
const BASE_FLIGHT_DURATION_HOURS = 7.5; // Bombardier Global 6000 takes about 7.5 hours

// OpenSky Network API Constants (N142QS Hex Code is A0AB8D)
const ICAO24_HEX = 'a0ab8d';
const CORS_PROXY = 'https://api.allorigins.win/raw?url=';
const OPENSKY_API_URL = `https://opensky-network.org/api/states/all?icao24=${ICAO24_HEX}`;

// App State
let flightState = {
    progress: 0.0, // 0.0 to 1.0 (used in simulation)
    isPlaying: true,
    speedMultiplier: 100, // Default to x100 speed for simulation
    liveMode: false, // True if the plane is active in the air
    telemetry: {
        speed: 902,
        altitude: 41000,
        distanceTraveled: 0,
        distanceRemaining: FLIGHT_DISTANCE_KM,
        elapsedTime: "00:00",
        remainingTime: "07:30",
        lat: MIAMI_COORDS.lat,
        lng: MIAMI_COORDS.lng
    }
};

// Web Audio API State
let audioCtx = null;
let synthInterval = null;
let isAudioPlaying = false;
let masterGain = null;

// Three.js Globals
let scene, camera, renderer, controls;
let earthMesh, starsPoints, atmosphereMesh;
let flightCurve, flightLine, planeMarker, flightParticles;
let miamiPin, rosarioPin;
let particleGeometry, particlePositions, particleCount = 120;
let flightTangent = new THREE.Vector3();

// DOM Elements
const speedBtn1 = document.getElementById('speed-1');
const speedBtn10 = document.getElementById('speed-10');
const speedBtn100 = document.getElementById('speed-100');
const speedBtn1000 = document.getElementById('speed-1000');
const playPauseBtn = document.getElementById('play-pause');
const audioBtn = document.getElementById('btn-audio');

// Header Status Elements
const statusDot = document.querySelector('.status-dot');
const statusText = document.querySelector('.status-text');

const valLat = document.getElementById('val-lat');
const valLng = document.getElementById('val-lng');
const valSpeed = document.getElementById('val-speed');
const valAlt = document.getElementById('val-alt');
const valDistTraveled = document.getElementById('val-dist-traveled');
const valDistRemaining = document.getElementById('val-dist-remaining');
const valElapsed = document.getElementById('val-elapsed');
const valRemaining = document.getElementById('val-remaining');
const progressBarFill = document.getElementById('progress-bar-fill');
const progressPercent = document.getElementById('progress-percent');

// Initialize the application
function init() {
    setupThree();
    createEnvironment();
    createGlobe();
    createFlightPath();
    setupInteraction();
    
    // Start OpenSky polling (every 15 seconds)
    pollLiveFlightData();
    setInterval(pollLiveFlightData, 15000);
    
    animate(0);
    
    // Set initial speed styling
    updateSpeedControls();
}

// -------------------------------------------------------------
// THREE.JS SETUP
// -------------------------------------------------------------
function setupThree() {
    const container = document.getElementById('canvas-container');
    
    // Scene
    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x050814, 0.0015);
    
    // Camera
    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(-150, 100, 250);
    
    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;
    container.appendChild(renderer.domElement);
    
    // Controls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 120;
    controls.maxDistance = 400;
    
    // Lights
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.25);
    scene.add(ambientLight);
    
    // Sun light (directed to light up Americas/Atlantic)
    const sunLight = new THREE.DirectionalLight(0xffffff, 1.8);
    sunLight.position.set(200, 100, 150);
    scene.add(sunLight);

    // Blue glow light from below (space glow)
    const spaceLight = new THREE.DirectionalLight(0x74acdf, 0.7);
    spaceLight.position.set(-200, -100, -150);
    scene.add(spaceLight);
    
    window.addEventListener('resize', onWindowResize);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// -------------------------------------------------------------
// ENVIRONMENT & STARFIELD
// -------------------------------------------------------------
function createEnvironment() {
    // Starfield system
    const starsCount = 2000;
    const starsGeom = new THREE.BufferGeometry();
    const positions = new Float32Array(starsCount * 3);
    const colors = new Float32Array(starsCount * 3);
    
    for (let i = 0; i < starsCount; i++) {
        // Random point on sphere far away
        const radius = 400 + Math.random() * 200;
        const u = Math.random();
        const v = Math.random();
        const theta = u * 2.0 * Math.PI;
        const phi = Math.acos(2.0 * v - 1.0);
        
        positions[i * 3] = radius * Math.sin(phi) * Math.sin(theta);
        positions[i * 3 + 1] = radius * Math.cos(phi);
        positions[i * 3 + 2] = radius * Math.sin(phi) * Math.cos(theta);
        
        // Colors: mostly white/silver, some argentine celeste tones
        const arg = Math.random();
        if (arg > 0.8) {
            colors[i * 3] = 0.45; // R
            colors[i * 3 + 1] = 0.67; // G
            colors[i * 3 + 2] = 0.87; // B (Celeste)
        } else {
            const bright = 0.6 + Math.random() * 0.4;
            colors[i * 3] = bright;
            colors[i * 3 + 1] = bright;
            colors[i * 3 + 2] = bright;
        }
    }
    
    starsGeom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    starsGeom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    
    const starsMaterial = new THREE.PointsMaterial({
        size: 1.5,
        vertexColors: true,
        transparent: true,
        opacity: 0.8,
        sizeAttenuation: true
    });
    
    starsPoints = new THREE.Points(starsGeom, starsMaterial);
    scene.add(starsPoints);
}

// -------------------------------------------------------------
// GLOBE & ATMOSPHERE
// -------------------------------------------------------------
function createGlobe() {
    const earthGeo = new THREE.SphereGeometry(GLOBE_RADIUS, 64, 64);
    const textureLoader = new THREE.TextureLoader();
    
    // High-quality earth textures from unpkg (three-globe examples)
    const earthTextureUrl = 'https://unpkg.com/three-globe/example/img/earth-night.jpg';
    const bumpTextureUrl = 'https://unpkg.com/three-globe/example/img/earth-topology.png';
    
    const earthMat = new THREE.MeshStandardMaterial({
        color: 0x111625,
        roughness: 0.8,
        metalness: 0.1,
    });
    
    // Try to load textures, fallback gracefully on error
    textureLoader.load(earthTextureUrl, 
        (texture) => {
            earthMat.map = texture;
            earthMat.color.setHex(0xffffff); // resetting to full white to let texture show
            earthMat.needsUpdate = true;
        },
        undefined,
        (err) => {
            console.warn("Could not load night earth texture, generating procedural fallback.", err);
            // Procedural fallback map drawn onto canvas
            const canvas = document.createElement('canvas');
            canvas.width = 1024;
            canvas.height = 512;
            const ctx = canvas.getContext('2d');
            
            const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
            gradient.addColorStop(0, '#040817');
            gradient.addColorStop(0.5, '#0b162f');
            gradient.addColorStop(1, '#040817');
            ctx.fillStyle = gradient;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            // Draw grid lines
            ctx.strokeStyle = 'rgba(116, 172, 223, 0.15)'; // faint celeste
            ctx.lineWidth = 1;
            
            const numLat = 18;
            const numLng = 36;
            for (let i = 0; i <= numLat; i++) {
                const y = (i / numLat) * canvas.height;
                ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
            }
            for (let i = 0; i <= numLng; i++) {
                const x = (i / numLng) * canvas.width;
                ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
            }
            
            // Draw stylized continent dots
            ctx.fillStyle = 'rgba(116, 172, 223, 0.4)';
            for (let i = 0; i < 2000; i++) {
                const x = Math.random() * canvas.width;
                const y = Math.random() * canvas.height;
                
                let isLand = false;
                if (x > 250 && x < 380 && y > 280 && y < 480) isLand = true; // South America
                if (x > 100 && x < 300 && y > 100 && y < 280) isLand = true; // North America
                if (x > 450 && x < 580 && y > 220 && y < 400) isLand = true; // Africa
                if (x > 470 && x < 600 && y > 100 && y < 220) isLand = true; // Europe
                if (x > 600 && x < 900 && y > 100 && y < 480) isLand = true; // Asia / Australia
                
                if (isLand) {
                    ctx.beginPath();
                    ctx.arc(x, y, 1.2, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
            
            const dynamicTexture = new THREE.CanvasTexture(canvas);
            earthMat.map = dynamicTexture;
            earthMat.needsUpdate = true;
        }
    );
    
    textureLoader.load(bumpTextureUrl, 
        (texture) => {
            earthMat.bumpMap = texture;
            earthMat.bumpScale = 1.5;
            earthMat.needsUpdate = true;
        }
    );
    
    earthMesh = new THREE.Mesh(earthGeo, earthMat);
    scene.add(earthMesh);
    
    // Atmospheric glow
    const atmosphereGeo = new THREE.SphereGeometry(GLOBE_RADIUS * 1.015, 64, 64);
    
    const vertexShader = `
        varying vec3 vNormal;
        void main() {
            vNormal = normalize(normalMatrix * normal);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `;
    
    const fragmentShader = `
        varying vec3 vNormal;
        void main() {
            float intensity = pow(0.65 - dot(vNormal, vec3(0, 0, 1.0)), 2.5);
            gl_FragColor = vec4(0.45, 0.67, 0.87, 1.0) * intensity * 0.7;
        }
    `;
    
    const atmosphereMat = new THREE.ShaderMaterial({
        vertexShader: vertexShader,
        fragmentShader: fragmentShader,
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide,
        transparent: true
    });
    
    atmosphereMesh = new THREE.Mesh(atmosphereGeo, atmosphereMat);
    scene.add(atmosphereMesh);
}

// -------------------------------------------------------------
// MATH & COORD CONVERSIONS
// -------------------------------------------------------------
function latLngToVector3(lat, lng, radius) {
    const phi = (90 - lat) * (Math.PI / 180);
    const theta = (lng + 180) * (Math.PI / 180);
    
    return new THREE.Vector3(
        -radius * Math.sin(phi) * Math.sin(theta),
        radius * Math.cos(phi),
        radius * Math.sin(phi) * Math.cos(theta)
    );
}

function vector3ToLatLng(vector) {
    const norm = vector.clone().normalize();
    const lat = Math.asin(norm.y) * (180 / Math.PI);
    const lng = Math.atan2(norm.z, -norm.x) * (180 / Math.PI) - 180;
    
    let wrappedLng = ((lng + 180) % 360) - 180;
    if (wrappedLng < -180) wrappedLng += 360;
    
    return { lat, lng: wrappedLng };
}

// -------------------------------------------------------------
// FLIGHT PATH & MARKERS
// -------------------------------------------------------------
function createFlightPath() {
    const startVec = latLngToVector3(MIAMI_COORDS.lat, MIAMI_COORDS.lng, GLOBE_RADIUS);
    const endVec = latLngToVector3(ROSARIO_COORDS.lat, ROSARIO_COORDS.lng, GLOBE_RADIUS);
    
    // Calculate control points for a smooth, high-altitude 3D bezier arc
    const midPoint = new THREE.Vector3().addVectors(startVec, endVec).multiplyScalar(0.5);
    const distance = startVec.distanceTo(endVec);
    
    const arcHeight = GLOBE_RADIUS + distance * 0.28;
    midPoint.normalize().multiplyScalar(arcHeight);
    
    const control1 = startVec.clone().normalize().multiplyScalar(GLOBE_RADIUS + distance * 0.12);
    control1.addScaledVector(midPoint.clone().sub(startVec), 0.35);
    
    const control2 = endVec.clone().normalize().multiplyScalar(GLOBE_RADIUS + distance * 0.12);
    control2.addScaledVector(midPoint.clone().sub(endVec), 0.35);
    
    flightCurve = new THREE.CubicBezierCurve3(startVec, control1, control2, endVec);
    
    // Create the visible path line
    const points = flightCurve.getPoints(100);
    const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
    const lineMat = new THREE.LineBasicMaterial({
        color: 0x74acdf,
        linewidth: 2,
        transparent: true,
        opacity: 0.6
    });
    
    flightLine = new THREE.Line(lineGeo, lineMat);
    scene.add(flightLine);
    
    // Airport Pins
    miamiPin = createAirportMarker(startVec, 0x74acdf, "MIA");
    rosarioPin = createAirportMarker(endVec, 0xf6b426, "ROS");
    
    // Procedural Airplane Model (Bombardier Global 6000)
    const planeGroup = new THREE.Group();
    
    const fuseGeo = new THREE.ConeGeometry(1.6, 7.5, 8);
    fuseGeo.rotateX(Math.PI / 2);
    const fuseMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.2,
        metalness: 0.8,
        emissive: 0x74acdf,
        emissiveIntensity: 0.1
    });
    const fuselage = new THREE.Mesh(fuseGeo, fuseMat);
    planeGroup.add(fuselage);
    
    const wingGeo = new THREE.BufferGeometry();
    const wingVertices = new Float32Array([
        0.0, 0.0, 1.5,
        -8.0, 0.0, -2.5,
        8.0, 0.0, -2.5,
        0.0, 0.0, -3.5
    ]);
    const wingIndices = [0, 1, 3, 0, 3, 2];
    wingGeo.setAttribute('position', new THREE.BufferAttribute(wingVertices, 3));
    wingGeo.setIndex(wingIndices);
    wingGeo.computeVertexNormals();
    
    const wingMat = new THREE.MeshStandardMaterial({
        color: 0xd8e6f3,
        roughness: 0.3,
        metalness: 0.7,
        side: THREE.DoubleSide
    });
    const wings = new THREE.Mesh(wingGeo, wingMat);
    planeGroup.add(wings);
    
    const tailGeo = new THREE.BufferGeometry();
    const tailVertices = new Float32Array([
        0.0, 0.0, -2.0,
        0.0, 2.5, -3.5,
        0.0, 0.0, -3.8
    ]);
    const tailIndices = [0, 1, 2];
    tailGeo.setAttribute('position', new THREE.BufferAttribute(tailVertices, 3));
    tailGeo.setIndex(tailIndices);
    tailGeo.computeVertexNormals();
    
    const tail = new THREE.Mesh(tailGeo, wingMat);
    planeGroup.add(tail);
    
    const engineLight = new THREE.PointLight(0x74acdf, 4, 15);
    engineLight.position.set(0, 0, -4.5);
    planeGroup.add(engineLight);
    
    planeMarker = planeGroup;
    planeMarker.scale.set(0.7, 0.7, 0.7);
    scene.add(planeMarker);
    
    // Trail Particles
    particleGeometry = new THREE.BufferGeometry();
    particlePositions = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i++) {
        particlePositions[i * 3] = startVec.x;
        particlePositions[i * 3 + 1] = startVec.y;
        particlePositions[i * 3 + 2] = startVec.z;
    }
    particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
    
    const pColors = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i++) {
        const factor = Math.random();
        if (factor < 0.45) { // Celeste
            pColors[i * 3] = 0.45; pColors[i * 3 + 1] = 0.67; pColors[i * 3 + 2] = 0.87;
        } else if (factor < 0.9) { // Blanco
            pColors[i * 3] = 1.0; pColors[i * 3 + 1] = 1.0; pColors[i * 3 + 2] = 1.0;
        } else { // Oro
            pColors[i * 3] = 0.96; pColors[i * 3 + 1] = 0.7; pColors[i * 3 + 2] = 0.15;
        }
    }
    particleGeometry.setAttribute('color', new THREE.BufferAttribute(pColors, 3));
    
    const pMat = new THREE.PointsMaterial({
        size: 2.2,
        vertexColors: true,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true
    });
    
    flightParticles = new THREE.Points(particleGeometry, pMat);
    scene.add(flightParticles);
}

function createAirportMarker(position, hexColor, label) {
    const group = new THREE.Group();
    
    const ringGeo = new THREE.RingGeometry(1, 3.5, 16);
    const ringMat = new THREE.MeshBasicMaterial({
        color: hexColor,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.7
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.lookAt(position);
    ring.position.copy(position);
    group.add(ring);
    
    const dir = position.clone().normalize();
    const beaconLength = 12;
    const beaconPoints = [
        position,
        position.clone().addScaledVector(dir, beaconLength)
    ];
    const beaconGeo = new THREE.BufferGeometry().setFromPoints(beaconPoints);
    const beaconMat = new THREE.LineBasicMaterial({
        color: hexColor,
        transparent: true,
        opacity: 0.4
    });
    const beacon = new THREE.Line(beaconGeo, beaconMat);
    group.add(beacon);
    
    const dotGeo = new THREE.SphereGeometry(0.8, 8, 8);
    const dotMat = new THREE.MeshBasicMaterial({ color: hexColor });
    const dot = new THREE.Mesh(dotGeo, dotMat);
    dot.position.copy(position.clone().addScaledVector(dir, beaconLength));
    group.add(dot);
    
    scene.add(group);
    return group;
}

// -------------------------------------------------------------
// LIVE FLIGHT DATA API FETCH (OPENSKY NETWORK)
// -------------------------------------------------------------
async function pollLiveFlightData() {
    try {
        const response = await fetch(CORS_PROXY + encodeURIComponent(OPENSKY_API_URL));
        if (!response.ok) throw new Error("Network response was not ok");
        const data = await response.json();
        
        // Check if states exist and are populated (meaning plane is active)
        if (data.states && data.states.length > 0) {
            const state = data.states[0];
            
            // OpenSky state vector values:
            // state[1] = callsigh
            // state[5] = longitude (lng)
            // state[6] = latitude (lat)
            // state[7] = baro_altitude (meters)
            // state[9] = velocity (meters/s)
            const lng = state[5];
            const lat = state[6];
            const altMeters = state[7] || 12496; // fallback to 41000 ft in meters
            const velocityMs = state[9] || 250; // fallback to 900 km/h in m/s
            
            const altFeet = Math.round(altMeters * 3.28084);
            const speedKmh = Math.round(velocityMs * 3.6);
            
            // Calculate progress mathematically based on current position relative to Miami and Rosario
            const startVec = latLngToVector3(MIAMI_COORDS.lat, MIAMI_COORDS.lng, GLOBE_RADIUS);
            const endVec = latLngToVector3(ROSARIO_COORDS.lat, ROSARIO_COORDS.lng, GLOBE_RADIUS);
            const currentVec = latLngToVector3(lat, lng, GLOBE_RADIUS);
            
            const distFromStart = startVec.distanceTo(currentVec);
            const distFromEnd = currentVec.distanceTo(endVec);
            
            let calculatedProgress = distFromStart / (distFromStart + distFromEnd);
            calculatedProgress = Math.max(0.0, Math.min(calculatedProgress, 1.0));
            
            flightState.liveMode = true;
            flightState.progress = calculatedProgress;
            flightState.telemetry.lat = lat;
            flightState.telemetry.lng = lng;
            flightState.telemetry.altitude = altFeet;
            flightState.telemetry.speed = speedKmh;
            
            // Enable visual live indicators
            statusDot.className = "status-dot live";
            statusText.className = "status-text live";
            statusText.innerText = "Transponder en Vivo (ADS-B)";
            
            // Hide/Disable speed multipliers as they do not apply to live tracking
            document.querySelectorAll('.speed-btn').forEach(btn => btn.style.opacity = '0.3');
            speedBtn1.style.opacity = '1';
            
            console.log(`Live data updated: Lat ${lat}, Lng ${lng}, Alt ${altFeet}ft, Speed ${speedKmh}kmh, Progress ${(calculatedProgress*100).toFixed(2)}%`);
        } else {
            // Plane is on the ground, run in simulated/playback mode
            if (flightState.liveMode) {
                // If we were live and now lost signal, fall back
                flightState.liveMode = false;
                enableSimulationControls();
            }
            
            // Update status text to show it's simulated in real-time
            statusDot.className = "status-dot simulated";
            statusText.className = "status-text simulated";
            statusText.innerText = "En Tierra (Modo Simulado)";
        }
    } catch (err) {
        console.warn("Unable to fetch live flight data (OpenSky). Running in simulated playback mode.", err);
        // Ensure simulation mode is formatted correctly
        statusDot.className = "status-dot simulated";
        statusText.className = "status-text simulated";
        statusText.innerText = "En Tierra (Modo Simulado)";
    }
}

function enableSimulationControls() {
    document.querySelectorAll('.speed-btn').forEach(btn => btn.style.opacity = '1');
    updateSpeedControls();
}

// -------------------------------------------------------------
// WEB AUDIO API - CINEMATIC SYNTHESIZER
// -------------------------------------------------------------
function initAudio() {
    if (audioCtx) return;
    
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.setValueAtTime(0.0, audioCtx.currentTime);
    masterGain.connect(audioCtx.destination);
    
    masterGain.gain.linearRampToValueAtTime(0.35, audioCtx.currentTime + 2.0);
    startAmbientChords();
}

function startAmbientChords() {
    let tick = 0;
    
    // Chord progression (Am - F - C - G) in slow cinematic rhythm
    const progression = [
        [110, 164.81, 220, 261.63], // Am
        [87.31, 130.81, 174.61, 220], // F
        [130.81, 196.00, 261.63, 329.63], // C
        [98.00, 146.83, 196.00, 246.94]  // G
    ];
    
    function playChord() {
        if (!isAudioPlaying) return;
        
        const chordsIndex = tick % progression.length;
        const notes = progression[chordsIndex];
        const now = audioCtx.currentTime;
        const duration = 6.0;
        
        notes.forEach((freq, index) => {
            const osc = audioCtx.createOscillator();
            const oscGain = audioCtx.createGain();
            const filter = audioCtx.createBiquadFilter();
            
            osc.type = index % 2 === 0 ? 'triangle' : 'sine';
            osc.frequency.setValueAtTime(freq, now);
            osc.detune.setValueAtTime((Math.random() - 0.5) * 15, now);
            
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(400 + index * 100, now);
            filter.Q.setValueAtTime(1.0, now);
            
            oscGain.gain.setValueAtTime(0, now);
            oscGain.gain.linearRampToValueAtTime(0.08, now + 1.5 + (index * 0.2));
            oscGain.gain.exponentialRampToValueAtTime(0.0001, now + duration - 0.2);
            
            osc.connect(oscGain);
            oscGain.connect(filter);
            filter.connect(masterGain);
            
            osc.start(now);
            osc.stop(now + duration);
        });
        
        if (tick % 2 === 0) {
            playHighArpeggio(notes, now);
        }
        tick++;
    }
    
    playChord();
    synthInterval = setInterval(playChord, 5500);
}

function playHighArpeggio(baseNotes, startTime) {
    const now = startTime;
    const highNotes = baseNotes.map(n => n * 4);
    
    highNotes.forEach((freq, idx) => {
        const delay = idx * 0.4;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + delay);
        
        gain.gain.setValueAtTime(0, now + delay);
        gain.gain.linearRampToValueAtTime(0.015, now + delay + 0.1);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 1.2);
        
        const delayNode = audioCtx.createDelay();
        delayNode.delayTime.setValueAtTime(0.3, now);
        
        const feedback = audioCtx.createGain();
        feedback.gain.setValueAtTime(0.4, now);
        
        osc.connect(gain);
        gain.connect(delayNode);
        delayNode.connect(feedback);
        feedback.connect(delayNode);
        
        gain.connect(masterGain);
        delayNode.connect(masterGain);
        
        osc.start(now + delay);
        osc.stop(now + delay + 2.0);
    });
}

function toggleAudio() {
    if (!isAudioPlaying) {
        isAudioPlaying = true;
        if (!audioCtx) {
            initAudio();
        } else {
            masterGain.gain.linearRampToValueAtTime(0.35, audioCtx.currentTime + 1.0);
        }
        audioBtn.classList.add('playing');
        audioBtn.innerHTML = `
            <svg style="width:16px;height:16px;fill:currentColor" viewBox="0 0 24 24">
                <path d="M12,4L9.91,6.09L12,8.18M19,12C19,14.37 17.65,16.42 15.7,17.4L17.15,18.85C19.46,17.15 21,14.76 21,12C21,6.5 16.5,2 11,2V4M3,2.27L1.73,3.54L7.73,9.54L7,10H3V14H7L12,19V13.82L16.24,18.06C14.8,19.16 13,19.83 11,20V22C13.56,21.73 15.89,20.73 17.74,19.56L20.46,22.27L21.73,21L3,2.27Z"/>
            </svg>
            Sonido Activo
        `;
    } else {
        isAudioPlaying = false;
        if (masterGain) {
            masterGain.gain.linearRampToValueAtTime(0.0001, audioCtx.currentTime + 1.0);
        }
        audioBtn.classList.remove('playing');
        audioBtn.innerHTML = `
            <svg style="width:16px;height:16px;fill:currentColor" viewBox="0 0 24 24">
                <path d="M14,3.23V5.29C16.89,6.15 19,8.83 19,12C19,15.17 16.89,17.85 14,18.71V20.77C18,19.86 21,16.28 21,12C21,7.72 18,4.14 14,3.23M16.5,12C16.5,10.23 15.5,8.71 14,7.97V16C15.5,15.29 16.5,13.77 16.5,12M3,9V15H7L12,20V4L7,9H3Z"/>
            </svg>
            Activar Sonido
        `;
    }
}

// -------------------------------------------------------------
// SIMULATION & TELEMETRY LOGIC
// -------------------------------------------------------------
let lastTime = 0;

function updateTelemetry(progress, deltaTime) {
    if (progress >= 1.0) {
        progress = 1.0;
        if (!flightState.liveMode) {
            flightState.isPlaying = false;
            playPauseBtn.innerHTML = `
                <svg style="width:16px;height:16px;fill:currentColor" viewBox="0 0 24 24">
                    <path d="M17.65,6.35C16.2,4.9 14.21,4 12,4A8,8 0 0,0 4,12A8,8 0 0,0 12,20C15.73,20 18.84,17.45 19.73,14H17.65C16.83,16.33 14.61,18 12,18A6,6 0 0,1 6,12A6,6 0 0,1 12,6C13.66,6 15.14,6.69 16.22,7.78L13,11H20V4L17.65,6.35Z"/>
                </svg>
                Reiniciar Vuelo
            `;
        }
    }
    
    // Progress metrics
    const pct = Math.min(progress * 100, 100);
    progressBarFill.style.width = `${pct}%`;
    progressPercent.innerText = `${pct.toFixed(1)}%`;
    
    let currentSpeed, currentAlt, coords;
    
    if (flightState.liveMode) {
        // Use live values fetched from transponder
        currentSpeed = flightState.telemetry.speed;
        currentAlt = flightState.telemetry.altitude;
        coords = { lat: flightState.telemetry.lat, lng: flightState.telemetry.lng };
    } else {
        // Calculate simulated values
        const baseSpeed = 902;
        const speedDrift = Math.sin(Date.now() / 15000) * 12 + (Math.random() - 0.5) * 4;
        currentSpeed = Math.round(baseSpeed + speedDrift);
        
        const baseAlt = 41000;
        const altDrift = Math.cos(Date.now() / 20000) * 150;
        let altTemp = baseAlt + altDrift;
        if (progress < 0.08) {
            altTemp = Math.max(1500, baseAlt * (progress / 0.08));
        } else if (progress > 0.92) {
            altTemp = Math.max(300, baseAlt * ((1.0 - progress) / 0.08));
        }
        currentAlt = Math.round(altTemp);
        
        // Find Lat/Lng from current 3D position
        const plane3DPos = planeMarker.position;
        coords = vector3ToLatLng(plane3DPos);
    }
    
    // Distances
    const distTraveled = Math.min(FLIGHT_DISTANCE_KM * progress, FLIGHT_DISTANCE_KM);
    const distRemaining = Math.max(FLIGHT_DISTANCE_KM - distTraveled, 0);
    
    // Times
    const totalDurationSecs = BASE_FLIGHT_DURATION_HOURS * 3600;
    const elapsedSecs = totalDurationSecs * progress;
    const remainingSecs = totalDurationSecs * (1 - progress);
    
    const formatTime = (secs) => {
        const hrs = Math.floor(secs / 3600);
        const mins = Math.floor((secs % 3600) / 60);
        return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')} hs`;
    };
    
    // Update DOM
    valLat.innerText = `${Math.abs(coords.lat).toFixed(4)}° ${coords.lat >= 0 ? 'N' : 'S'}`;
    valLng.innerText = `${Math.abs(coords.lng).toFixed(4)}° ${coords.lng >= 0 ? 'E' : 'W'}`;
    valSpeed.innerText = `${currentSpeed} km/h`;
    valAlt.innerText = `${currentAlt.toLocaleString()} pies`;
    valDistTraveled.innerText = `${Math.round(distTraveled).toLocaleString()} km`;
    valDistRemaining.innerText = `${Math.round(distRemaining).toLocaleString()} km`;
    valElapsed.innerText = formatTime(elapsedSecs);
    valRemaining.innerText = formatTime(remainingSecs);
}

// -------------------------------------------------------------
// INTERACTION & BUTTON BINDINGS
// -------------------------------------------------------------
function setupInteraction() {
    playPauseBtn.addEventListener('click', () => {
        if (flightState.liveMode) {
            console.log("Play/Pause action disabled in live transponder mode.");
            return;
        }
        
        if (flightState.progress >= 1.0) {
            flightState.progress = 0.0;
            flightState.isPlaying = true;
            playPauseBtn.innerHTML = `
                <svg style="width:16px;height:16px;fill:currentColor" viewBox="0 0 24 24">
                    <path d="M14,19H18V5H14M6,19H10V5H6V19Z"/>
                </svg>
                Pausar Vuelo
            `;
            
            const startVec = latLngToVector3(MIAMI_COORDS.lat, MIAMI_COORDS.lng, GLOBE_RADIUS);
            const positions = particleGeometry.attributes.position.array;
            for (let i = 0; i < particleCount; i++) {
                positions[i * 3] = startVec.x;
                positions[i * 3 + 1] = startVec.y;
                positions[i * 3 + 2] = startVec.z;
            }
            particleGeometry.attributes.position.needsUpdate = true;
        } else {
            flightState.isPlaying = !flightState.isPlaying;
            if (flightState.isPlaying) {
                playPauseBtn.innerHTML = `
                    <svg style="width:16px;height:16px;fill:currentColor" viewBox="0 0 24 24">
                        <path d="M14,19H18V5H14M6,19H10V5H6V19Z"/>
                    </svg>
                    Pausar Vuelo
                `;
            } else {
                playPauseBtn.innerHTML = `
                    <svg style="width:16px;height:16px;fill:currentColor" viewBox="0 0 24 24">
                        <path d="M8,5V19L19,12L8,5Z"/>
                    </svg>
                    Reanudar Vuelo
                `;
            }
        }
    });
    
    audioBtn.addEventListener('click', toggleAudio);
    
    const changeSpeed = (multiplier) => {
        if (flightState.liveMode) return; // ignore during live transponder tracking
        flightState.speedMultiplier = multiplier;
        updateSpeedControls();
    };
    
    speedBtn1.addEventListener('click', () => changeSpeed(1));
    speedBtn10.addEventListener('click', () => changeSpeed(10));
    speedBtn100.addEventListener('click', () => changeSpeed(100));
    speedBtn1000.addEventListener('click', () => changeSpeed(1000));
}

function updateSpeedControls() {
    const buttons = [speedBtn1, speedBtn10, speedBtn100, speedBtn1000];
    buttons.forEach(btn => btn.classList.remove('active'));
    
    if (flightState.speedMultiplier === 1) speedBtn1.classList.add('active');
    else if (flightState.speedMultiplier === 10) speedBtn10.classList.add('active');
    else if (flightState.speedMultiplier === 100) speedBtn100.classList.add('active');
    else if (flightState.speedMultiplier === 1000) speedBtn1000.classList.add('active');
}

// -------------------------------------------------------------
// MAIN ANIMATION LOOP
// -------------------------------------------------------------
function animate(time) {
    requestAnimationFrame(animate);
    
    const deltaTime = (time - lastTime) / 1000;
    lastTime = time;
    
    // Slow planetary spin when not interacting
    if (!controls.state === -1) {
        earthMesh.rotation.y += 0.0008;
        atmosphereMesh.rotation.y += 0.0008;
    }
    
    controls.update();
    starsPoints.rotation.y += 0.00015;
    
    let currentPoint;
    
    if (flightState.liveMode) {
        // In Live Mode, the position is directly calculated from live Lat/Lng
        const planeGeoPos = latLngToVector3(flightState.telemetry.lat, flightState.telemetry.lng, GLOBE_RADIUS);
        
        // Find height of flight arc at this progress to match Three.js visual elevation
        const projectedProgressPoint = flightCurve.getPointAt(flightState.progress);
        const arcHeight = projectedProgressPoint.length(); // distance from center of globe
        
        currentPoint = planeGeoPos.normalize().multiplyScalar(arcHeight);
    } else {
        // In Simulation Mode, progress increases based on timer
        if (flightState.isPlaying) {
            const progressIncrement = (deltaTime / (BASE_FLIGHT_DURATION_HOURS * 3600)) * flightState.speedMultiplier;
            flightState.progress = Math.min(flightState.progress + progressIncrement, 1.0);
        }
        currentPoint = flightCurve.getPointAt(flightState.progress);
    }
    
    // Position plane model
    planeMarker.position.copy(currentPoint);
    
    // Orient the airplane to align with the heading/direction
    if (flightState.progress < 1.0) {
        flightTangent = flightCurve.getTangentAt(flightState.progress).normalize();
        const targetLook = currentPoint.clone().add(flightTangent);
        planeMarker.lookAt(targetLook);
        
        // Stabilize wings
        const radialUp = currentPoint.clone().normalize();
        const localRight = new THREE.Vector3().crossVectors(flightTangent, radialUp).normalize();
        const orthogonalUp = new THREE.Vector3().crossVectors(localRight, flightTangent).normalize();
        planeMarker.up.copy(orthogonalUp);
    }
    
    // Update trailing flight particles
    updateTrailParticles(currentPoint);
    
    // Synchronize telemetry UI values
    updateTelemetry(flightState.progress, deltaTime);
    
    renderer.render(scene, camera);
}

function updateTrailParticles(planePos) {
    const positions = particleGeometry.attributes.position.array;
    
    const shouldUpdate = flightState.liveMode || (flightState.isPlaying && flightState.progress < 1.0);
    
    if (shouldUpdate && Math.random() > 0.4) {
        for (let i = particleCount - 1; i > 0; i--) {
            positions[i * 3] = positions[(i - 1) * 3];
            positions[i * 3 + 1] = positions[(i - 1) * 3 + 1];
            positions[i * 3 + 2] = positions[(i - 1) * 3 + 2];
        }
        
        const spread = 0.5;
        positions[0] = planePos.x + (Math.random() - 0.5) * spread;
        positions[1] = planePos.y + (Math.random() - 0.5) * spread;
        positions[2] = planePos.z + (Math.random() - 0.5) * spread;
        
        particleGeometry.attributes.position.needsUpdate = true;
    }
}

// Start everything
init();
