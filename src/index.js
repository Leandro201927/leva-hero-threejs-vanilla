import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

// Scene setup
const scene = new THREE.Scene();
let camera;
let renderer;
let mixer;
let model;
let coinObject;

// Initialize renderer
function initRenderer() {
    renderer = new THREE.WebGLRenderer({ 
        antialias: true,
        alpha: true 
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    
    const container = document.getElementById('canvas-container');
    container.appendChild(renderer.domElement);
}

// Setup lighting with RoomEnvironment
function setupLighting() {
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();
    
    const environment = new RoomEnvironment();
    const envMap = pmremGenerator.fromScene(environment).texture;
    
    scene.environment = envMap;
    scene.background = new THREE.Color(0x111111);
    
    environment.dispose();
    pmremGenerator.dispose();
}

// Load GLB model
function loadModel() {
    const loader = new GLTFLoader();
    
    // Setup DRACOLoader for compressed models
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
    dracoLoader.setDecoderConfig({ type: 'js' });
    loader.setDRACOLoader(dracoLoader);
    
    const loadingElement = document.getElementById('loading');
    
    loader.load(
        './assets/v3 __.glb',
        (gltf) => {
            console.log('Model loaded successfully');
            model = gltf.scene;
            scene.add(model);
            
            // Log the scene structure to help debug
            console.log('Scene structure:');
            model.traverse((child) => {
                console.log('- Object:', child.name, '| Type:', child.type);
            });
            
            // Find and use camera from the model
            const modelCamera = model.getObjectByName('Camera');
            if (modelCamera && modelCamera.isCamera) {
                camera = modelCamera;
                camera.aspect = window.innerWidth / window.innerHeight;
                camera.updateProjectionMatrix();
                console.log('Using camera from model:', camera.name);
            } else {
                // Fallback camera if not found in model
                console.warn('Camera not found in model, using default camera');
                camera = new THREE.PerspectiveCamera(
                    75,
                    window.innerWidth / window.innerHeight,
                    0.1,
                    1000
                );
                camera.position.set(0, 2, 5);
                camera.lookAt(0, 0, 0);
            }
            
            // Find the Coin object and setup animation
            coinObject = model.getObjectByName('Coin');
            if (coinObject) {
                console.log('Coin object found:', coinObject.name);
            } else {
                console.warn('Coin object not found in the model');
            }
            
            // Setup animations
            if (gltf.animations && gltf.animations.length > 0) {
                mixer = new THREE.AnimationMixer(model);
                
                // Find animation related to Coin or play all animations
                gltf.animations.forEach((clip, index) => {
                    console.log(`Animation ${index}:`, clip.name, '| Duration:', clip.duration);
                    
                    // Check if this animation affects the Coin object
                    const isCoinAnimation = clip.tracks.some(track => 
                        track.name.includes('Coin')
                    );
                    
                    if (isCoinAnimation || gltf.animations.length === 1) {
                        const action = mixer.clipAction(clip);
                        action.setLoop(THREE.LoopRepeat, Infinity);
                        action.play();
                        console.log('Playing animation:', clip.name);
                    }
                });
                
                // If no specific Coin animation found, play all animations
                if (mixer._actions.length === 0 && gltf.animations.length > 0) {
                    console.log('No Coin-specific animation found, playing all animations');
                    gltf.animations.forEach(clip => {
                        const action = mixer.clipAction(clip);
                        action.setLoop(THREE.LoopRepeat, Infinity);
                        action.play();
                    });
                }
            } else {
                console.warn('No animations found in the model');
            }
            
            // Hide loading screen
            loadingElement.classList.add('hidden');
            
            // Start animation loop
            animate();
        },
        (progress) => {
            const percent = (progress.loaded / progress.total * 100).toFixed(0);
            console.log(`Loading: ${percent}%`);
        },
        (error) => {
            console.error('Error loading model:', error);
            loadingElement.innerHTML = `
                <div class="spinner"></div>
                <div>Error loading 3D model</div>
                <div style="font-size: 14px; color: #ff6b6b;">${error.message}</div>
            `;
        }
    );
}

// Animation loop
const clock = new THREE.Clock();

function animate() {
    requestAnimationFrame(animate);
    
    const delta = clock.getDelta();
    
    // Update animation mixer
    if (mixer) {
        mixer.update(delta);
    }
    
    // Render the scene
    if (camera) {
        renderer.render(scene, camera);
    }
}

// Handle window resize
function onWindowResize() {
    if (camera) {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
    }
    renderer.setSize(window.innerWidth, window.innerHeight);
}

// Initialize everything
function init() {
    initRenderer();
    setupLighting();
    loadModel();
    
    window.addEventListener('resize', onWindowResize);
}

// Start the application
init();
