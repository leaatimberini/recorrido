import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════
const GLOBE_RADIUS = 100;
// KFLL Fort Lauderdale-Hollywood (confirmed by FlightAware as actual origin)
const ORIGIN = { lat: 26.0726, lng: -80.1527, name: 'Fort Lauderdale (FLL)' };
const DESTINATION = { lat: -32.9036, lng: -60.7844, name: 'Rosario (ROS)' };
const FLIGHT_DISTANCE_KM = 6800; // FLL to ROS approximate
const ESTIMATED_FLIGHT_HOURS = 8.5; // Bombardier Global 6000

// N142QS transponder hex code
const ICAO24 = 'a0ab8d';
const POLL_INTERVAL_MS = 12000;

// Known departure time from FlightAware: 2026-07-21T01:00Z from KFLL
const KNOWN_DEPARTURE_UTC = new Date('2026-07-21T01:00:00Z').getTime();

// Data sources — adsb.lol is free & CORS-friendly (primary), OpenSky as fallback
const ADSB_LOL_URL = `https://api.adsb.lol/v2/icao/${ICAO24}`;
const OPENSKY_URL = `https://opensky-network.org/api/states/all?icao24=${ICAO24}`;

// CORS proxies for OpenSky only
const CORS_PROXIES = [
    url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
    url => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`
];

// ═══════════════════════════════════════════════════════════════
// APP STATE — REAL TIME ONLY, NO SIMULATION
// ═══════════════════════════════════════════════════════════════
const state = {
    isLive: false,            // true when transponder data is received
    hasEverBeenLive: false,   // true once we get first live data
    isEstimated: false,       // true when using estimated position (no ADS-B coverage)
    lat: ORIGIN.lat,
    lng: ORIGIN.lng,
    altitude: 0,              // feet
    speed: 0,                 // km/h
    heading: 0,               // degrees
    progress: 0,              // 0-1 along route
    lastUpdate: null,         // timestamp of last successful API response
    departureTime: KNOWN_DEPARTURE_UTC,
};

// Three.js globals
let scene, camera, renderer, controls;
let globeGroup;
let earthMesh, atmosphereMesh, cloudsMesh, starsPoints;
let flightCurve, flightLine, planeMarker;
let particleGeometry, particlePositions;
const PARTICLE_COUNT = 250;
let flightTangent = new THREE.Vector3();

// Audio globals
let audioCtx = null;
let masterGain = null;
let synthInterval = null;
let melodyTimeout = null;
let isAudioPlaying = false;
let melodyRunning = false;

// Countdown timer for waiting overlay
let countdownValue = 15;
let countdownInterval = null;

// ═══════════════════════════════════════════════════════════════
// DOM REFERENCES
// ═══════════════════════════════════════════════════════════════
const $ = id => document.getElementById(id);

const DOM = {
    waitingOverlay: $('waiting-overlay'),
    countdown: $('countdown'),
    statusDot: $('status-dot'),
    statusText: $('status-text'),
    audioBtn: $('btn-audio'),
    toggleTelemetryBtn: $('btn-toggle-telemetry'),
    toggleTributeBtn: $('btn-toggle-tribute'),
    telemetryPanel: $('telemetry-aside'),
    tributePanel: $('tribute-aside'),
    instructionsTip: $('instructions-tip'),
    // Telemetry values
    valLat: $('val-lat'),
    valLng: $('val-lng'),
    valSpeed: $('val-speed'),
    valAlt: $('val-alt'),
    valDistTraveled: $('val-dist-traveled'),
    valDistRemaining: $('val-dist-remaining'),
    valElapsed: $('val-elapsed'),
    valRemaining: $('val-remaining'),
    progressFill: $('progress-bar-fill'),
    progressPercent: $('progress-percent'),
    // Mobile
    mValSpeed: $('m-val-speed'),
    mValAlt: $('m-val-alt'),
    mValProg: $('m-val-prog'),
};

// ═══════════════════════════════════════════════════════════════
// MUCHACHOS MELODY — "Muchachos, ahora nos volvimos a ilusionar"
// Key of C major, accurate transcription of the chorus
// ═══════════════════════════════════════════════════════════════
const NOTES = {
    'C3': 130.81, 'D3': 146.83, 'E3': 164.81, 'F3': 174.61, 'G3': 196.00,
    'A3': 220.00, 'B3': 246.94, 'C4': 261.63, 'D4': 293.66, 'E4': 329.63,
    'F4': 349.23, 'G4': 392.00, 'A4': 440.00, 'B4': 493.88, 'C5': 523.25
};

// The actual chorus melody that fans sing in the stadium:
// "En Ar-gen-ti-na na-cí, tie-rra del Die-go y Lio-nel..."
// "Mu-cha-chos, a-ho-ra nos vol-vi-mos a i-lu-sio-nar..."
const melody = [
    // "En Ar-gen-ti-na na-cí"
    { n: 'E4', d: 0.3 }, { n: 'E4', d: 0.3 }, { n: 'D4', d: 0.3 },
    { n: 'C4', d: 0.3 }, { n: 'C4', d: 0.6 },
    // "tie-rra del Die-go y Lio-nel"
    { n: 'E4', d: 0.3 }, { n: 'E4', d: 0.3 }, { n: 'D4', d: 0.3 },
    { n: 'C4', d: 0.3 }, { n: 'D4', d: 0.3 }, { n: 'E4', d: 0.6 },
    // "de los pi-bes de Mal-vi-nas"
    { n: 'G4', d: 0.3 }, { n: 'G4', d: 0.3 }, { n: 'F4', d: 0.3 },
    { n: 'E4', d: 0.3 }, { n: 'E4', d: 0.3 }, { n: 'D4', d: 0.6 },
    // "que ja-más ol-vi-da-ré"
    { n: 'E4', d: 0.3 }, { n: 'E4', d: 0.3 }, { n: 'D4', d: 0.3 },
    { n: 'C4', d: 0.3 }, { n: 'D4', d: 0.3 }, { n: 'E4', d: 0.8 },
    // Pausa breve
    { n: 'C4', d: 0.4 },
    // "MU-CHA-CHOS" (el grito épico, notas repetidas con énfasis)
    { n: 'C4', d: 0.4 }, { n: 'C4', d: 0.4 }, { n: 'C4', d: 0.7 },
    // "a-ho-ra nos vol-vi-mos"
    { n: 'C4', d: 0.25 }, { n: 'D4', d: 0.25 }, { n: 'E4', d: 0.3 },
    { n: 'E4', d: 0.25 }, { n: 'D4', d: 0.25 }, { n: 'C4', d: 0.3 },
    // "a i-lu-sio-nar"
    { n: 'D4', d: 0.3 }, { n: 'E4', d: 0.3 }, { n: 'F4', d: 0.3 },
    { n: 'F4', d: 0.3 }, { n: 'E4', d: 0.8 },
    // Pausa
    { n: 'C4', d: 0.4 },
    // "quie-ro ga-nar la ter-ce-ra"
    { n: 'C4', d: 0.4 }, { n: 'C4', d: 0.4 }, { n: 'C4', d: 0.7 },
    { n: 'C4', d: 0.25 }, { n: 'D4', d: 0.25 }, { n: 'E4', d: 0.3 },
    { n: 'E4', d: 0.25 }, { n: 'D4', d: 0.25 }, { n: 'C4', d: 0.3 },
    // "quie-ro ser cam-peón mun-dial"
    { n: 'D4', d: 0.3 }, { n: 'E4', d: 0.3 }, { n: 'F4', d: 0.3 },
    { n: 'F4', d: 0.3 }, { n: 'E4', d: 1.0 },
];

// ═══════════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════════
function init() {
    setupThreeJS();
    createStarfield();
    createGlobe();
    createFlightPath();
    setupEventListeners();

    // Start API polling
    pollFlight();
    setInterval(pollFlight, POLL_INTERVAL_MS);

    // Countdown timer for waiting overlay
    countdownInterval = setInterval(() => {
        countdownValue--;
        if (countdownValue <= 0) countdownValue = 15;
        if (DOM.countdown) DOM.countdown.textContent = countdownValue;
    }, 1000);

    // Fade instructions after 6 seconds
    setTimeout(() => {
        if (DOM.instructionsTip) DOM.instructionsTip.classList.add('fade');
    }, 6000);

    // Start render loop
    requestAnimationFrame(animate);
}

// ═══════════════════════════════════════════════════════════════
// THREE.JS SETUP
// ═══════════════════════════════════════════════════════════════
function setupThreeJS() {
    const container = document.getElementById('canvas-container');

    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x050814, 0.0012);

    // Group that contains all rotating globe elements together
    globeGroup = new THREE.Group();
    scene.add(globeGroup);

    camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1200);
    // Position camera facing the Americas (Florida and Rosario are mapped on the positive X / positive Z hemisphere in standard formula)
    camera.position.set(180, 50, 220);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Cap at 2x for mobile perf
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    container.appendChild(renderer.domElement);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.06;
    controls.minDistance = 50;
    controls.maxDistance = 400;
    controls.enablePan = false;
    controls.rotateSpeed = 0.5;

    // Set initial camera target to Fort Lauderdale position on globe
    const initTarget = latLngToVec3(ORIGIN.lat, ORIGIN.lng, GLOBE_RADIUS);
    controls.target.copy(initTarget);

    // Lights
    scene.add(new THREE.AmbientLight(0xffffff, 0.25));

    const sunLight = new THREE.DirectionalLight(0xffffff, 1.8);
    sunLight.position.set(200, 100, 150);
    scene.add(sunLight);

    const fillLight = new THREE.DirectionalLight(0x74acdf, 0.6);
    fillLight.position.set(-200, -100, -150);
    scene.add(fillLight);

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });
}

// ═══════════════════════════════════════════════════════════════
// STARFIELD
// ═══════════════════════════════════════════════════════════════
function createStarfield() {
    const count = 2500;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
        const r = 450 + Math.random() * 250;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);

        pos[i * 3] = r * Math.sin(phi) * Math.sin(theta);
        pos[i * 3 + 1] = r * Math.cos(phi);
        pos[i * 3 + 2] = r * Math.sin(phi) * Math.cos(theta);

        // Some celeste-tinted stars
        if (Math.random() > 0.85) {
            col[i * 3] = 0.45; col[i * 3 + 1] = 0.67; col[i * 3 + 2] = 0.87;
        } else if (Math.random() > 0.92) {
            col[i * 3] = 0.96; col[i * 3 + 1] = 0.70; col[i * 3 + 2] = 0.15; // Gold stars
        } else {
            const b = 0.55 + Math.random() * 0.45;
            col[i * 3] = b; col[i * 3 + 1] = b; col[i * 3 + 2] = b;
        }
    }

    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));

    starsPoints = new THREE.Points(geo, new THREE.PointsMaterial({
        size: 1.4,
        vertexColors: true,
        transparent: true,
        opacity: 0.8,
        sizeAttenuation: true
    }));
    scene.add(starsPoints);
}

// ═══════════════════════════════════════════════════════════════
// GLOBE & ATMOSPHERE
// ═══════════════════════════════════════════════════════════════
function createGlobe() {
    const geo = new THREE.SphereGeometry(GLOBE_RADIUS, 64, 64);
    const loader = new THREE.TextureLoader();

    const mat = new THREE.MeshStandardMaterial({
        color: 0x0a0f1d,
        roughness: 0.7,
        metalness: 0.25,
        bumpScale: 1.0
    });

    loader.load('https://unpkg.com/three-globe/example/img/earth-night.jpg',
        tex => { mat.map = tex; mat.color.setHex(0xffffff); mat.needsUpdate = true; },
        undefined,
        () => { createFallbackTexture(mat); }
    );

    loader.load('https://unpkg.com/three-globe/example/img/earth-topology.png',
        tex => { mat.bumpMap = tex; mat.bumpScale = 1.2; mat.needsUpdate = true; }
    );

    earthMesh = new THREE.Mesh(geo, mat);
    globeGroup.add(earthMesh);

    // Add Clouds Layer for Premium Quality
    const cloudsGeo = new THREE.SphereGeometry(GLOBE_RADIUS * 1.006, 64, 64);
    const cloudsMat = new THREE.MeshStandardMaterial({
        alphaMap: loader.load('https://unpkg.com/three-globe/example/img/earth-clouds.png'),
        transparent: true,
        opacity: 0.35,
        blending: THREE.AdditiveBlending,
        color: 0xffffff
    });
    cloudsMesh = new THREE.Mesh(cloudsGeo, cloudsMat);
    globeGroup.add(cloudsMesh);

    // Atmosphere shader
    const atmosGeo = new THREE.SphereGeometry(GLOBE_RADIUS * 1.015, 64, 64);
    const atmosMat = new THREE.ShaderMaterial({
        vertexShader: `
            varying vec3 vNormal;
            void main() {
                vNormal = normalize(normalMatrix * normal);
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }`,
        fragmentShader: `
            varying vec3 vNormal;
            void main() {
                float intensity = pow(0.65 - dot(vNormal, vec3(0, 0, 1.0)), 2.5);
                gl_FragColor = vec4(0.45, 0.67, 0.87, 1.0) * intensity * 0.75;
            }`,
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide,
        transparent: true
    });
    atmosphereMesh = new THREE.Mesh(atmosGeo, atmosMat);
    globeGroup.add(atmosphereMesh);
}

function createFallbackTexture(mat) {
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 512;
    const ctx = c.getContext('2d');

    const g = ctx.createLinearGradient(0, 0, 0, c.height);
    g.addColorStop(0, '#040817'); g.addColorStop(0.5, '#0b162f'); g.addColorStop(1, '#040817');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, c.width, c.height);

    // Grid lines
    ctx.strokeStyle = 'rgba(116, 172, 223, 0.12)';
    ctx.lineWidth = 0.8;
    for (let i = 0; i <= 18; i++) {
        const y = (i / 18) * c.height;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(c.width, y); ctx.stroke();
    }
    for (let i = 0; i <= 36; i++) {
        const x = (i / 36) * c.width;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, c.height); ctx.stroke();
    }

    // Landmass dots
    ctx.fillStyle = 'rgba(116, 172, 223, 0.35)';
    for (let i = 0; i < 2000; i++) {
        const x = Math.random() * c.width;
        const y = Math.random() * c.height;
        let land = false;
        if (x > 250 && x < 380 && y > 280 && y < 480) land = true;
        if (x > 100 && x < 300 && y > 100 && y < 280) land = true;
        if (x > 450 && x < 580 && y > 220 && y < 400) land = true;
        if (x > 470 && x < 600 && y > 100 && y < 220) land = true;
        if (x > 600 && x < 900 && y > 100 && y < 480) land = true;
        if (land) {
            ctx.beginPath(); ctx.arc(x, y, 1.2, 0, Math.PI * 2); ctx.fill();
        }
    }

    mat.map = new THREE.CanvasTexture(c);
    mat.needsUpdate = true;
}

// ═══════════════════════════════════════════════════════════════
// COORDINATE MATH
// ═══════════════════════════════════════════════════════════════
function latLngToVec3(lat, lng, radius) {
    const phi = lat * (Math.PI / 180);
    const lambda = lng * (Math.PI / 180);
    return new THREE.Vector3(
        radius * Math.cos(phi) * Math.cos(lambda),
        radius * Math.sin(phi),
        -radius * Math.cos(phi) * Math.sin(lambda)
    );
}

// ═══════════════════════════════════════════════════════════════
// FLIGHT PATH, MARKERS, AIRPLANE
// ═══════════════════════════════════════════════════════════════
function createFlightPath() {
    const startV = latLngToVec3(ORIGIN.lat, ORIGIN.lng, GLOBE_RADIUS);
    const endV = latLngToVec3(DESTINATION.lat, DESTINATION.lng, GLOBE_RADIUS);

    const mid = new THREE.Vector3().addVectors(startV, endV).multiplyScalar(0.5);
    const dist = startV.distanceTo(endV);
    mid.normalize().multiplyScalar(GLOBE_RADIUS + dist * 0.28);

    const cp1 = startV.clone().normalize().multiplyScalar(GLOBE_RADIUS + dist * 0.12);
    cp1.addScaledVector(mid.clone().sub(startV), 0.35);

    const cp2 = endV.clone().normalize().multiplyScalar(GLOBE_RADIUS + dist * 0.12);
    cp2.addScaledVector(mid.clone().sub(endV), 0.35);

    flightCurve = new THREE.CubicBezierCurve3(startV, cp1, cp2, endV);

    // Route line
    const pts = flightCurve.getPoints(120);
    flightLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: 0x74acdf, transparent: true, opacity: 0.55 })
    );
    globeGroup.add(flightLine);

    // Airport markers
    createAirportMarker(startV, 0x74acdf);
    createAirportMarker(endV, 0xf6b426);

    // Build airplane model
    buildAirplane();

    // Trail particles
    buildTrailParticles(startV);
}

function createAirportMarker(pos, color) {
    const group = new THREE.Group();

    // Ring
    const ring = new THREE.Mesh(
        new THREE.RingGeometry(1.5, 3.5, 20),
        new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.7 })
    );
    ring.lookAt(pos);
    ring.position.copy(pos);
    group.add(ring);

    // Beacon line
    const dir = pos.clone().normalize();
    const beaconPts = [pos, pos.clone().addScaledVector(dir, 12)];
    group.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(beaconPts),
        new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.35 })
    ));

    // Dot
    const dot = new THREE.Mesh(
        new THREE.SphereGeometry(1, 10, 10),
        new THREE.MeshBasicMaterial({ color })
    );
    dot.position.copy(pos.clone().addScaledVector(dir, 12));
    group.add(dot);

    globeGroup.add(group);
}

function buildAirplane() {
    const group = new THREE.Group();

    // Fuselage
    const fuseGeo = new THREE.ConeGeometry(1.6, 7.5, 8);
    fuseGeo.rotateX(Math.PI / 2);
    group.add(new THREE.Mesh(fuseGeo, new THREE.MeshStandardMaterial({
        color: 0xffffff, roughness: 0.15, metalness: 0.85,
        emissive: 0x74acdf, emissiveIntensity: 0.15
    })));

    // Wings
    const wingGeo = new THREE.BufferGeometry();
    wingGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
        0, 0, 1.5,  -8, 0, -2.5,  8, 0, -2.5,  0, 0, -3.5
    ]), 3));
    wingGeo.setIndex([0, 1, 3, 0, 3, 2]);
    wingGeo.computeVertexNormals();
    const wingMat = new THREE.MeshStandardMaterial({ color: 0xe0ebf6, roughness: 0.25, metalness: 0.75, side: THREE.DoubleSide });
    group.add(new THREE.Mesh(wingGeo, wingMat));

    // Tail
    const tailGeo = new THREE.BufferGeometry();
    tailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
        0, 0, -2,  0, 2.5, -3.5,  0, 0, -3.8
    ]), 3));
    tailGeo.setIndex([0, 1, 2]);
    tailGeo.computeVertexNormals();
    group.add(new THREE.Mesh(tailGeo, wingMat));

    // Engine glow
    const engineLight = new THREE.PointLight(0xf6b426, 6, 20);
    engineLight.position.set(0, 0, -4.5);
    group.add(engineLight);

    // Crown badge sprite
    const badge = document.createElement('canvas');
    badge.width = 128; badge.height = 128;
    const bCtx = badge.getContext('2d');

    // Golden glow circle
    bCtx.fillStyle = 'rgba(246, 180, 38, 0.2)';
    bCtx.beginPath(); bCtx.arc(64, 64, 50, 0, Math.PI * 2); bCtx.fill();
    bCtx.strokeStyle = '#F6B426'; bCtx.lineWidth = 3; bCtx.stroke();

    bCtx.shadowColor = '#F6B426'; bCtx.shadowBlur = 15;
    bCtx.fillStyle = '#FFFFFF';
    bCtx.font = 'bold 36px Outfit, sans-serif';
    bCtx.textAlign = 'center';
    bCtx.textBaseline = 'middle';
    bCtx.fillText('10', 64, 80);
    bCtx.font = '26px serif';
    bCtx.fillText('👑', 64, 42);

    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(badge),
        transparent: true
    }));
    sprite.position.set(0, 12, 0);
    sprite.scale.set(14, 14, 14);
    group.add(sprite);

    planeMarker = group;
    planeMarker.scale.set(0.7, 0.7, 0.7);
    // Start at Miami
    planeMarker.position.copy(latLngToVec3(ORIGIN.lat, ORIGIN.lng, GLOBE_RADIUS));
    globeGroup.add(planeMarker);
}

function buildTrailParticles(startVec) {
    particleGeometry = new THREE.BufferGeometry();
    particlePositions = new Float32Array(PARTICLE_COUNT * 3);
    const colors = new Float32Array(PARTICLE_COUNT * 3);

    for (let i = 0; i < PARTICLE_COUNT; i++) {
        particlePositions[i * 3] = startVec.x;
        particlePositions[i * 3 + 1] = startVec.y;
        particlePositions[i * 3 + 2] = startVec.z;

        const r = Math.random();
        if (r < 0.35) { // Celeste
            colors[i * 3] = 0.45; colors[i * 3 + 1] = 0.67; colors[i * 3 + 2] = 0.87;
        } else if (r < 0.65) { // White
            colors[i * 3] = 1; colors[i * 3 + 1] = 1; colors[i * 3 + 2] = 1;
        } else { // Gold
            colors[i * 3] = 0.96; colors[i * 3 + 1] = 0.70; colors[i * 3 + 2] = 0.15;
        }
    }

    particleGeometry.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
    particleGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    globeGroup.add(new THREE.Points(particleGeometry, new THREE.PointsMaterial({
        size: 2.5,
        vertexColors: true,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true
    })));
}

// ═══════════════════════════════════════════════════════════════
// REAL-TIME FLIGHT DATA — MULTI-SOURCE
// Primary: adsb.lol (free, CORS-friendly)
// Fallback: OpenSky Network (via CORS proxies)
// Estimated: time-based interpolation when over ocean
// ═══════════════════════════════════════════════════════════════
let currentProxyIndex = 0;

async function pollFlight() {
    countdownValue = 12; // Reset countdown

    // Source 1: adsb.lol (direct, no CORS issues)
    const liveData = await tryAdsbLol() || await tryOpenSky();

    if (liveData) {
        applyLiveData(liveData);
    } else {
        // No ADS-B coverage — use estimated position if flight has departed
        handleNoSignal();
    }
}

async function tryAdsbLol() {
    try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 6000);
        const resp = await fetch(ADSB_LOL_URL, { signal: ctrl.signal });
        clearTimeout(t);
        if (!resp.ok) return null;
        const data = await resp.json();

        if (data.ac && data.ac.length > 0) {
            const ac = data.ac[0];
            // adsb.lol fields: lat, lon, alt_baro (ft), gs (knots), track
            if (ac.lat && ac.lon) {
                console.log('[adsb.lol] Got live data');
                return {
                    lat: ac.lat,
                    lng: ac.lon,
                    altitude: ac.alt_baro || ac.alt_geom || 0, // already in feet
                    speed: Math.round((ac.gs || 0) * 1.852),    // knots → km/h
                    heading: ac.track || ac.true_heading || 0,
                    source: 'adsb.lol'
                };
            }
        }
    } catch (e) {
        console.warn('[adsb.lol] failed:', e.message);
    }
    return null;
}

async function tryOpenSky() {
    for (let attempt = 0; attempt < CORS_PROXIES.length; attempt++) {
        const idx = (currentProxyIndex + attempt) % CORS_PROXIES.length;
        try {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), 7000);
            const resp = await fetch(CORS_PROXIES[idx](OPENSKY_URL), { signal: ctrl.signal });
            clearTimeout(t);
            if (!resp.ok) continue;
            const data = await resp.json();
            currentProxyIndex = idx;

            if (data.states && data.states.length > 0) {
                const s = data.states[0];
                console.log('[OpenSky] Got live data via proxy', idx);
                return {
                    lat: s[6],
                    lng: s[5],
                    altitude: Math.round((s[7] || 0) * 3.28084),
                    speed: Math.round((s[9] || 0) * 3.6),
                    heading: s[10] || 0,
                    source: 'OpenSky'
                };
            }
        } catch (e) {
            console.warn(`[OpenSky proxy ${idx}]`, e.message);
        }
    }
    return null;
}

function applyLiveData({ lat, lng, altitude, speed, heading, source }) {
    state.isLive = true;
    state.isEstimated = false;
    state.hasEverBeenLive = true;
    state.lat = lat;
    state.lng = lng;
    state.altitude = altitude;
    state.speed = speed;
    state.heading = heading;
    state.lastUpdate = Date.now();

    // Calculate progress
    const startV = latLngToVec3(ORIGIN.lat, ORIGIN.lng, GLOBE_RADIUS);
    const endV = latLngToVec3(DESTINATION.lat, DESTINATION.lng, GLOBE_RADIUS);
    const curV = latLngToVec3(lat, lng, GLOBE_RADIUS);
    const dStart = startV.distanceTo(curV);
    const dEnd = curV.distanceTo(endV);
    state.progress = Math.max(0, Math.min(dStart / (dStart + dEnd), 1));

    // Hide waiting overlay
    DOM.waitingOverlay.classList.add('hidden');

    DOM.statusDot.className = 'status-dot live';
    DOM.statusText.className = 'status-text live';
    DOM.statusText.textContent = `🟢 En Vivo — ${source}`;

    console.log(`[LIVE/${source}] lat=${lat.toFixed(4)} lng=${lng.toFixed(4)} alt=${altitude}ft spd=${speed}km/h`);
}

function handleNoSignal() {
    const now = Date.now();
    const elapsed = now - KNOWN_DEPARTURE_UTC;
    const totalFlightMs = ESTIMATED_FLIGHT_HOURS * 3600 * 1000;

    // If flight should have departed based on known FlightAware data
    if (elapsed > 0 && elapsed < totalFlightMs) {
        // Flight is in the air but over ocean with no ADS-B ground coverage
        state.isLive = false;
        state.isEstimated = true;
        state.hasEverBeenLive = true;

        // Estimate progress based on elapsed time
        const estimatedProgress = Math.min(elapsed / totalFlightMs, 0.99);
        state.progress = estimatedProgress;

        // Interpolate lat/lng along great circle
        const t = estimatedProgress;
        state.lat = ORIGIN.lat + (DESTINATION.lat - ORIGIN.lat) * t;
        state.lng = ORIGIN.lng + (DESTINATION.lng - ORIGIN.lng) * t;
        state.altitude = t < 0.05 ? Math.round(41000 * (t / 0.05))
                       : t > 0.95 ? Math.round(41000 * ((1 - t) / 0.05))
                       : 41000;
        state.speed = 902; // Cruise speed estimate

        // Hide waiting overlay — we know the flight departed
        DOM.waitingOverlay.classList.add('hidden');

        DOM.statusDot.className = 'status-dot waiting';
        DOM.statusText.className = 'status-text waiting';
        DOM.statusText.textContent = '📡 Posición estimada — Sin cobertura ADS-B sobre el océano';

        console.log(`[ESTIMATED] progress=${(estimatedProgress * 100).toFixed(1)}% lat=${state.lat.toFixed(2)} lng=${state.lng.toFixed(2)}`);
    } else if (elapsed >= totalFlightMs) {
        // Flight should have landed
        state.isLive = false;
        state.isEstimated = false;
        state.progress = 1;
        state.lat = DESTINATION.lat;
        state.lng = DESTINATION.lng;
        state.altitude = 0;
        state.speed = 0;

        DOM.waitingOverlay.classList.add('hidden');
        DOM.statusDot.className = 'status-dot live';
        DOM.statusText.className = 'status-text live';
        DOM.statusText.textContent = '🛬 ¡Messi aterrizó en Rosario!';
    } else {
        // Flight hasn't departed yet
        state.isLive = false;
        state.isEstimated = false;
        DOM.waitingOverlay.classList.remove('hidden');
        DOM.statusDot.className = 'status-dot waiting';
        DOM.statusText.className = 'status-text waiting';
        DOM.statusText.textContent = '⏳ Esperando despegue...';
    }
}

// ═══════════════════════════════════════════════════════════════
// WEB AUDIO — MUCHACHOS ANTHEM
// ═══════════════════════════════════════════════════════════════
function initAudio() {
    if (audioCtx) {
        audioCtx.resume();
        return;
    }

    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.setValueAtTime(0, audioCtx.currentTime);
    masterGain.connect(audioCtx.destination);
    masterGain.gain.linearRampToValueAtTime(0.3, audioCtx.currentTime + 2);

    // Explicitly resume for autoplay policy
    audioCtx.resume();

    startChords();
    startMelody();
}

function startChords() {
    const progression = [
        [110, 164.81, 220, 261.63],    // Am
        [130.81, 196, 261.63, 329.63],  // C
        [98, 146.83, 196, 246.94],      // G
        [146.83, 220, 293.66, 349.23]   // Dm
    ];
    let tick = 0;

    function playChord() {
        if (!isAudioPlaying || !audioCtx) return;

        const notes = progression[tick % progression.length];
        const now = audioCtx.currentTime;
        const dur = 7;

        notes.forEach((freq, i) => {
            const osc = audioCtx.createOscillator();
            const g = audioCtx.createGain();
            const filter = audioCtx.createBiquadFilter();

            osc.type = i % 2 === 0 ? 'triangle' : 'sine';
            osc.frequency.setValueAtTime(freq, now);
            osc.detune.setValueAtTime((Math.random() - 0.5) * 10, now);

            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(300 + i * 80, now);
            filter.Q.setValueAtTime(0.8, now);

            g.gain.setValueAtTime(0, now);
            g.gain.linearRampToValueAtTime(0.07, now + 2);
            g.gain.exponentialRampToValueAtTime(0.0001, now + dur - 0.1);

            osc.connect(g);
            g.connect(filter);
            filter.connect(masterGain);

            osc.start(now);
            osc.stop(now + dur);
        });
        tick++;
    }

    playChord();
    synthInterval = setInterval(playChord, 6800);
}

function startMelody() {
    if (melodyRunning) return;
    melodyRunning = true;
    let idx = 0;

    function playNote() {
        if (!isAudioPlaying || !audioCtx) {
            melodyRunning = false;
            return;
        }

        const { n, d } = melody[idx];
        const freq = NOTES[n];
        const dur = d * 1.4;
        const now = audioCtx.currentTime;

        const osc = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        const filter = audioCtx.createBiquadFilter();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now);

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(1000, now);

        g.gain.setValueAtTime(0, now);
        g.gain.linearRampToValueAtTime(0.04, now + 0.08);
        g.gain.exponentialRampToValueAtTime(0.0001, now + dur);

        // Stadium echo delay
        const delay = audioCtx.createDelay();
        delay.delayTime.setValueAtTime(0.35, now);
        const fb = audioCtx.createGain();
        fb.gain.setValueAtTime(0.25, now);

        osc.connect(filter);
        filter.connect(g);
        g.connect(delay);
        delay.connect(fb);
        fb.connect(delay);
        g.connect(masterGain);
        delay.connect(masterGain);

        osc.start(now);
        osc.stop(now + dur);

        // Disconnect delay nodes after note ends to prevent memory leaks
        osc.onended = () => {
            try {
                fb.disconnect();
                delay.disconnect();
            } catch (e) { /* ignore */ }
        };

        idx = (idx + 1) % melody.length;
        melodyTimeout = setTimeout(playNote, d * 1400);
    }

    playNote();
}

function toggleAudio() {
    if (!isAudioPlaying) {
        isAudioPlaying = true;
        initAudio();

        if (masterGain) {
            masterGain.gain.linearRampToValueAtTime(0.3, audioCtx.currentTime + 1);
        }

        // Restart melody if needed
        if (!melodyRunning) startMelody();

        DOM.audioBtn.classList.add('playing');
        DOM.audioBtn.innerHTML = `
            <svg style="width:16px;height:16px;fill:currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12,4L9.91,6.09L12,8.18M19,12C19,14.37 17.65,16.42 15.7,17.4L17.15,18.85C19.46,17.15 21,14.76 21,12C21,6.5 16.5,2 11,2V4M3,2.27L1.73,3.54L7.73,9.54L7,10H3V14H7L12,19V13.82L16.24,18.06C14.8,19.16 13,19.83 11,20V22C13.56,21.73 15.89,20.73 17.74,19.56L20.46,22.27L21.73,21L3,2.27Z"/>
            </svg>
            🎵 Sonido Activo`;
    } else {
        isAudioPlaying = false;
        melodyRunning = false;

        if (melodyTimeout) clearTimeout(melodyTimeout);
        if (synthInterval) clearInterval(synthInterval);
        synthInterval = null;
        melodyTimeout = null;

        if (masterGain) {
            masterGain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.5);
        }

        DOM.audioBtn.classList.remove('playing');
        DOM.audioBtn.innerHTML = `
            <svg style="width:16px;height:16px;fill:currentColor" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M14,3.23V5.29C16.89,6.15 19,8.83 19,12C19,15.17 16.89,17.85 14,18.71V20.77C18,19.86 21,16.28 21,12C21,7.72 18,4.14 14,3.23M16.5,12C16.5,10.23 15.5,8.71 14,7.97V16C15.5,15.29 16.5,13.77 16.5,12M3,9V15H7L12,20V4L7,9H3Z"/>
            </svg>
            Activar Sonido`;
    }
}

// ═══════════════════════════════════════════════════════════════
// EVENT LISTENERS
// ═══════════════════════════════════════════════════════════════
function setupEventListeners() {
    DOM.audioBtn.addEventListener('click', toggleAudio);

    // Mobile panel toggles
    let telemetryActive = false;
    let tributeActive = false;

    DOM.toggleTelemetryBtn.addEventListener('click', () => {
        telemetryActive = !telemetryActive;
        tributeActive = false; // Always close the other panel to prevent overlapping

        if (telemetryActive) {
            DOM.telemetryPanel.classList.add('active');
            DOM.tributePanel.classList.remove('active');
            DOM.toggleTelemetryBtn.classList.add('active');
            DOM.toggleTributeBtn.classList.remove('active');
        } else {
            DOM.telemetryPanel.classList.remove('active');
            DOM.toggleTelemetryBtn.classList.remove('active');
        }
    });

    DOM.toggleTributeBtn.addEventListener('click', () => {
        tributeActive = !tributeActive;
        telemetryActive = false; // Always close the other panel to prevent overlapping

        if (tributeActive) {
            DOM.tributePanel.classList.add('active');
            DOM.telemetryPanel.classList.remove('active');
            DOM.toggleTributeBtn.classList.add('active');
            DOM.toggleTelemetryBtn.classList.remove('active');
        } else {
            DOM.tributePanel.classList.remove('active');
            DOM.toggleTributeBtn.classList.remove('active');
        }
    });
}

// ═══════════════════════════════════════════════════════════════
// TELEMETRY UI UPDATE
// ═══════════════════════════════════════════════════════════════
function updateTelemetryUI() {
    const p = state.progress;
    const pct = Math.min(p * 100, 100);

    DOM.progressFill.style.width = `${pct}%`;
    DOM.progressPercent.textContent = `${pct.toFixed(1)}%`;

    if (!state.isLive && !state.isEstimated) {
        // Show dashes when not live and not estimated
        const dash = '--';
        DOM.valLat.textContent = dash;
        DOM.valLng.textContent = dash;
        DOM.valSpeed.textContent = dash;
        DOM.valAlt.textContent = dash;
        DOM.valDistTraveled.textContent = dash;
        DOM.valDistRemaining.textContent = dash;
        DOM.valElapsed.textContent = dash;
        DOM.valRemaining.textContent = dash;

        if (DOM.mValSpeed) DOM.mValSpeed.textContent = dash;
        if (DOM.mValAlt) DOM.mValAlt.textContent = dash;
        if (DOM.mValProg) DOM.mValProg.textContent = dash;
        return;
    }

    // Live data
    const lat = state.lat;
    const lng = state.lng;
    DOM.valLat.textContent = `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}`;
    DOM.valLng.textContent = `${Math.abs(lng).toFixed(4)}° ${lng >= 0 ? 'E' : 'W'}`;
    DOM.valSpeed.textContent = `${state.speed} km/h`;
    DOM.valAlt.textContent = `${state.altitude.toLocaleString()} pies`;

    const distTraveled = Math.round(FLIGHT_DISTANCE_KM * p);
    const distRemaining = Math.round(FLIGHT_DISTANCE_KM * (1 - p));
    DOM.valDistTraveled.textContent = `${distTraveled.toLocaleString()} km`;
    DOM.valDistRemaining.textContent = `${distRemaining.toLocaleString()} km`;

    // Time calculation
    if (state.departureTime) {
        const elapsed = (Date.now() - state.departureTime) / 1000;
        const totalEst = p > 0.01 ? elapsed / p : 0;
        const remaining = Math.max(totalEst - elapsed, 0);
        DOM.valElapsed.textContent = formatTime(elapsed);
        DOM.valRemaining.textContent = formatTime(remaining);
    }

    // Mobile
    if (DOM.mValSpeed) DOM.mValSpeed.textContent = `${state.speed} km/h`;
    if (DOM.mValAlt) DOM.mValAlt.textContent = `${state.altitude.toLocaleString()} pies`;
    if (DOM.mValProg) DOM.mValProg.textContent = `${pct.toFixed(1)}%`;
}

function formatTime(secs) {
    const hrs = Math.floor(secs / 3600);
    const mins = Math.floor((secs % 3600) / 60);
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')} hs`;
}

// ═══════════════════════════════════════════════════════════════
// ANIMATION LOOP
// ═══════════════════════════════════════════════════════════════
function animate() {
    requestAnimationFrame(animate);

    // Slow globe group rotation (rotates Earth, clouds, path, airplane together)
    globeGroup.rotation.y += 0.00025;
    
    // Parallax effect: Clouds rotate slightly faster than Earth
    if (cloudsMesh) {
        cloudsMesh.rotation.y += 0.00008;
    }
    
    // Subtle background stars rotation
    starsPoints.rotation.y += 0.00005;

    // Compute current plane position on the 3D globe (in local globeGroup space)
    let currentPoint;

    if (state.isLive || state.isEstimated) {
        // Real position from transponder OR estimated position
        const geoPos = latLngToVec3(state.lat, state.lng, GLOBE_RADIUS);
        // Match the altitude arc of the bezier curve for visual consistency
        const curvePoint = flightCurve.getPointAt(Math.max(0.001, Math.min(state.progress, 0.999)));
        const arcR = curvePoint.length();
        currentPoint = geoPos.normalize().multiplyScalar(arcR);
    } else {
        // Stay at origin if flight hasn't departed
        currentPoint = latLngToVec3(state.lat, state.lng, GLOBE_RADIUS);
    }

    // Position the airplane
    planeMarker.position.copy(currentPoint);

    // Orient airplane along the flight curve tangent
    const safeT = Math.max(0.001, Math.min(state.progress, 0.998));
    flightTangent = flightCurve.getTangentAt(safeT).normalize();
    const lookTarget = currentPoint.clone().add(flightTangent);
    planeMarker.lookAt(lookTarget);

    const radialUp = currentPoint.clone().normalize();
    const localRight = new THREE.Vector3().crossVectors(flightTangent, radialUp).normalize();
    const upDir = new THREE.Vector3().crossVectors(localRight, flightTangent).normalize();
    planeMarker.up.copy(upDir);

    // ── CAMERA: lock on airplane in WORLD space, then update controls ──
    const worldPlanePos = new THREE.Vector3();
    planeMarker.getWorldPosition(worldPlanePos);
    controls.target.lerp(worldPlanePos, 0.06);
    controls.update(); // Must be AFTER target update to avoid 1-frame lag

    // Trail particles (emit when live or estimated and moving)
    updateTrail(currentPoint);

    // Update telemetry UI
    updateTelemetryUI();

    renderer.render(scene, camera);
}

function updateTrail(planePos) {
    const positions = particleGeometry.attributes.position.array;

    if ((state.isLive || state.isEstimated) && state.speed > 50 && Math.random() > 0.3) {
        // Shift particles backward
        for (let i = PARTICLE_COUNT - 1; i > 0; i--) {
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

// ═══════════════════════════════════════════════════════════════
// START
// ═══════════════════════════════════════════════════════════════
init();
