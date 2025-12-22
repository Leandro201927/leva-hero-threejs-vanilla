import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import GUI from 'lil-gui';

// Scene setup
const scene = new THREE.Scene();
let camera;
let renderer;
let mixer;
let model;
let coinObject;
let controls;
const textureLoader = new THREE.TextureLoader();
const bakedTexture = textureLoader.load('./assets/baked_final.jpg');
bakedTexture.flipY = false;
bakedTexture.colorSpace = THREE.SRGBColorSpace;
bakedTexture.minFilter = THREE.LinearFilter;
bakedTexture.magFilter = THREE.LinearFilter;
bakedTexture.generateMipmaps = false;

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
    scene.background = new THREE.Color(0xebe8e8); // Light gray-white background
    
    // Add fog with custom configuration
    scene.fog = new THREE.Fog(0xebe8e8, 0, 11.5);
    
    environment.dispose();
    pmremGenerator.dispose();
    
    // Setup GUI for fog controls
    setupFogGUI();
}

// Setup GUI for fog parameters
function setupFogGUI() {
    const gui = new GUI();
    gui.title('Fog Controls');
    
    const fogParams = {
        enabled: true,
        color: '#ebe8e8',
        near: 0,
        far: 11.5
    };
    
    gui.add(fogParams, 'enabled').name('Enable Fog').onChange((value) => {
        if (value) {
            scene.fog = new THREE.Fog(
                new THREE.Color(fogParams.color),
                fogParams.near,
                fogParams.far
            );
        } else {
            scene.fog = null;
        }
    });
    
    gui.addColor(fogParams, 'color').name('Fog Color').onChange((value) => {
        if (scene.fog) {
            scene.fog.color.set(value);
            scene.background.set(value);
        }
    });
    
    gui.add(fogParams, 'near', 0, 50, 0.1).name('Fog Near').onChange((value) => {
        if (scene.fog) {
            scene.fog.near = value;
        }
    });
    
    gui.add(fogParams, 'far', 0, 100, 0.1).name('Fog Far').onChange((value) => {
        if (scene.fog) {
            scene.fog.far = value;
        }
    });
    
    console.log('Fog GUI controls added');
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
                if (child.isMesh) {
                    child.material = new THREE.MeshBasicMaterial({ map: bakedTexture });
                }
                console.log('- Object:', child.name, '| Type:', child.type);
            });
            
            // Find and use camera from the model
            const modelCamera = model.getObjectByName('Camera');
            if (modelCamera && modelCamera.isCamera) {
                // If it's an orthographic camera from Blender
                if (modelCamera.isOrthographicCamera) {
                    camera = modelCamera;
                    
                    // Update frustum based on viewport aspect ratio
                    const aspect = window.innerWidth / window.innerHeight;
                    const frustumSize = camera.top - camera.bottom; // Get original frustum size
                    
                    camera.left = -frustumSize * aspect / 2;
                    camera.right = frustumSize * aspect / 2;
                    camera.top = frustumSize / 2;
                    camera.bottom = -frustumSize / 2;
                    
                    // Apply custom camera settings
                    camera.position.set(4.078, 2.260, 3.643);
                    camera.rotation.set(-2.707, 0.071, 3.109);
                    camera.zoom = 1.228;
                    
                    camera.updateProjectionMatrix();
                    console.log('Using orthographic camera from model:', camera.name);
                    console.log('Camera frustum:', { left: camera.left, right: camera.right, top: camera.top, bottom: camera.bottom });
                    console.log('Applied custom camera position and zoom');
                } else {
                    // If it's a perspective camera, convert it to orthographic
                    const aspect = window.innerWidth / window.innerHeight;
                    const frustumSize = 5; // Default frustum size
                    
                    camera = new THREE.OrthographicCamera(
                        -frustumSize * aspect / 2,
                        frustumSize * aspect / 2,
                        frustumSize / 2,
                        -frustumSize / 2,
                        0.1,
                        1000
                    );
                    
                    // Apply custom camera settings
                    camera.position.set(4.078, 2.260, 3.643);
                    camera.rotation.set(-2.707, 0.071, 3.109);
                    camera.zoom = 1.228;
                    
                    camera.updateProjectionMatrix();
                    console.log('Converted perspective camera to orthographic');
                    console.log('Applied custom camera position and zoom');
                }
            } else {
                // Fallback orthographic camera if not found in model
                console.warn('Camera not found in model, using default orthographic camera');
                const aspect = window.innerWidth / window.innerHeight;
                const frustumSize = 5;
                
                camera = new THREE.OrthographicCamera(
                    -frustumSize * aspect / 2,
                    frustumSize * aspect / 2,
                    frustumSize / 2,
                    -frustumSize / 2,
                    0.1,
                    1000
                );
                
                // Apply custom camera settings
                camera.position.set(4.078, 2.260, 3.643);
                camera.rotation.set(-2.707, 0.071, 3.109);
                camera.zoom = 1.228;
                
                camera.updateProjectionMatrix();
                console.log('Applied custom camera position and zoom');
            }
            
            // Setup OrbitControls
            controls = new OrbitControls(camera, renderer.domElement);
            controls.enableDamping = true;
            controls.dampingFactor = 0.05;
            controls.screenSpacePanning = false;
            controls.minDistance = 1;
            controls.maxDistance = 100;
            
            // Set custom target position
            controls.target.set(3.694, 0.000, 8.516);
            controls.update();
            
            console.log('OrbitControls enabled with custom target');
            
            // Log camera position/rotation when controls change
            controls.addEventListener('change', () => {
                console.log('📷 Camera Position:', {
                    position: {
                        x: camera.position.x.toFixed(3),
                        y: camera.position.y.toFixed(3),
                        z: camera.position.z.toFixed(3)
                    },
                    rotation: {
                        x: camera.rotation.x.toFixed(3),
                        y: camera.rotation.y.toFixed(3),
                        z: camera.rotation.z.toFixed(3)
                    },
                    target: {
                        x: controls.target.x.toFixed(3),
                        y: controls.target.y.toFixed(3),
                        z: controls.target.z.toFixed(3)
                    },
                    zoom: camera.zoom.toFixed(3)
                });
            });
            
            // Find the Coin object and setup animation
            coinObject = model.getObjectByName('Coin');
            if (coinObject) {
                console.log('Coin object found:', coinObject.name);
            } else {
                console.warn('Coin object not found in the model');
            }
            
            // Setup animations
            /*
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
            */
            
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
    
    // Update controls
    if (controls) {
        controls.update();
    }
    
    // Render the scene
    if (camera) {
        renderer.render(scene, camera);
    }
}

// Handle window resize
function onWindowResize() {
    if (camera) {
        if (camera.isOrthographicCamera) {
            const aspect = window.innerWidth / window.innerHeight;
            const frustumSize = camera.top - camera.bottom; // Maintain current frustum size
            
            camera.left = -frustumSize * aspect / 2;
            camera.right = frustumSize * aspect / 2;
            camera.top = frustumSize / 2;
            camera.bottom = -frustumSize / 2;
            
            camera.updateProjectionMatrix();
        } else {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
        }
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
