// 1. SETUP & ENGINE
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87CEEB);
scene.fog = new THREE.FogExp2(0x87CEEB, 0.04); // Neblina para esconder o spawn de chunks

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const renderDistance = 4; 
const activeChunks = new Map();

// 2. MATERIAIS
const loader = new THREE.TextureLoader();
function loadTex(path) {
    const t = loader.load(path);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    return t;
}

const mat = {
    grass: new THREE.MeshStandardMaterial({ map: loadTex('grass.png') }),
    tijolo: new THREE.MeshStandardMaterial({ map: loadTex('stonebrick.png') }),
    log: new THREE.MeshStandardMaterial({ map: loadTex('log.png') }),
    leaf: new THREE.MeshStandardMaterial({ map: loadTex('leave.png'), transparent: true, alphaTest: 0.5 }),
    nuvem: new THREE.MeshBasicMaterial({ map: loadTex('cloud.png'), transparent: true, alphaTest: 0.1, depthWrite: false, fog: false }),
    mato: new THREE.MeshStandardMaterial({ map: loadTex('bush.png'), transparent: true, alphaTest: 0.5, side: THREE.DoubleSide })
};

// 3. ESTADO GLOBAL
let worldData = JSON.parse(localStorage.getItem('alphadev_save')) || { blocks: {}, seed: Math.random() * 1000 };
let blocks = [], meshesParaInteracao = [], nuvens = [];
let chunkGroup; 
const chunkSize = 10;
let blocoAtual = 'grass', podeInteragir = true;

// 4. FUNÇÕES DE SUPORTE (SOL, NUVENS, MATO, ÁRVORES)
const luzSol = new THREE.DirectionalLight(0xffffff, 1.2);
luzSol.position.set(50, 100, 50);
scene.add(luzSol, new THREE.AmbientLight(0xffffff, 0.4));

const sunMesh = new THREE.Mesh(new THREE.SphereGeometry(15, 32, 32), new THREE.MeshBasicMaterial({ color: 0xFFD700, fog: false }));
scene.add(sunMesh);

function criarNuvem(x, z) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(30, 15), mat.nuvem);
    mesh.position.set(x, 70 + Math.random() * 20, z);
    mesh.rotation.x = Math.PI / 2;
    scene.add(mesh);
    nuvens.push(mesh);
}
for(let i=0; i<10; i++) criarNuvem((Math.random()-0.5)*400, (Math.random()-0.5)*400);

function adicionarMatoAoChunk(x, y, z, grupo) {
    const geo = new THREE.PlaneGeometry(1, 1);
    const p1 = new THREE.Mesh(geo, mat.mato);
    const p2 = new THREE.Mesh(geo, mat.mato);
    p2.rotation.y = Math.PI / 2;
    p1.position.set(x, y + 0.5, z);
    p2.position.set(x, y + 0.5, z);
    grupo.add(p1, p2);
    meshesParaInteracao.push(p1, p2);
}

function criarArvore(x, y, z, grupo) {
    const tronco = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 4, 12), mat.log);
    tronco.position.set(x, y + 2, z);
    const copa = new THREE.Mesh(new THREE.SphereGeometry(1.8, 12, 12), mat.leaf);
    copa.position.set(x, y + 4.5, z);
    grupo.add(tronco, copa);
    blocks.push({ mesh: tronco, box: new THREE.Box3().setFromObject(tronco) });
    meshesParaInteracao.push(tronco, copa);
}

// 5. GERAÇÃO DE MUNDO & OTIMIZAÇÃO
function gerarChunk(cx, cz) {
    const key = `${cx},${cz}`;
    if (activeChunks.has(key)) return;
    const group = new THREE.Group();
    activeChunks.set(key, group);
    scene.add(group);
    for (let x = 0; x < chunkSize; x++) {
        for (let z = 0; z < chunkSize; z++) {
            const wx = cx * chunkSize + x;
            const wz = cz * chunkSize + z;
            let h = Math.floor(Math.sin((wx + worldData.seed) * 0.1) * 3 + 5);
            const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat.grass);
            mesh.position.set(wx, h, wz);
            group.add(mesh);
            blocks.push({ mesh, box: new THREE.Box3().setFromObject(mesh) });
            meshesParaInteracao.push(mesh);
            if (Math.random() < 0.08) adicionarMatoAoChunk(wx, h, wz, group);
            if (Math.random() < 0.01) criarArvore(wx, h, wz, group);
        }
    }
}

function limparChunks() {
    const pCX = Math.floor(player.pos.x / chunkSize);
    const pCZ = Math.floor(player.pos.z / chunkSize);
    for (let [key, group] of activeChunks) {
        const [cx, cz] = key.split(',').map(Number);
        if (Math.abs(cx - pCX) > renderDistance || Math.abs(cz - pCZ) > renderDistance) {
            scene.remove(group);
            blocks = blocks.filter(b => !group.children.includes(b.mesh));
            meshesParaInteracao = meshesParaInteracao.filter(m => !group.children.includes(m));
            activeChunks.delete(key);
        }
    }
}

// 6. FÍSICA E INPUTS
let player = { pos: new THREE.Vector3(0, 15, 0), vel: new THREE.Vector3(), w: 0.6, h: 1.8, noChao: false };
let moveF = 0, moveS = 0, rotX = 0, rotY = 0;
camera.rotation.order = "YXZ";

function updateFisica() {
    player.vel.y -= 0.015;
    const dir = new THREE.Vector3(); camera.getWorldDirection(dir); dir.y = 0; dir.normalize();
    const side = new THREE.Vector3().crossVectors(camera.up, dir).negate();
    const vx = (dir.x * moveF + side.x * moveS) * 0.15, vz = (dir.z * moveF + side.z * moveS) * 0.15;
    const check = (p) => {
        const box = new THREE.Box3().setFromCenterAndSize(p, new THREE.Vector3(player.w, player.h, player.w));
        return blocks.some(b => box.intersectsBox(b.box));
    };
    player.pos.x += vx; if (check(player.pos)) player.pos.x -= vx;
    player.pos.z += vz; if (check(player.pos)) player.pos.z -= vz;
    player.pos.y += player.vel.y;
    if (check(player.pos)) { player.pos.y -= player.vel.y; if (player.vel.y < 0) player.noChao = true; player.vel.y = 0; }
}

let toques = {};
window.addEventListener('touchstart', e => { 
    for(let t of e.changedTouches) if(t.clientX > window.innerWidth / 2) toques[t.identifier] = { x: t.clientX, y: t.clientY };
}, { passive: false });
window.addEventListener('touchmove', e => {
    for(let t of e.changedTouches) {
        let d = toques[t.identifier];
        if(d) { rotY -= (t.clientX - d.x) * 0.007; rotX -= (t.clientY - d.y) * 0.007; rotX = Math.max(-1.5, Math.min(1.5, rotX)); d.x = t.clientX; d.y = t.clientY; }
    }
}, { passive: false });
window.addEventListener('touchend', e => { for(let t of e.changedTouches) delete toques[t.identifier]; });

nipplejs.create({ zone: document.getElementById('joystick-container'), mode: 'static', position: {left:'70px', bottom:'70px'} })
    .on('move', (e, d) => { moveF = d.vector.y; moveS = d.vector.x; })
    .on('end', () => { moveF = 0; moveS = 0; });

// 7. UI E INTERAÇÃO
window.mudarBloco = (tipo, el) => {
    blocoAtual = tipo;
    document.querySelectorAll('.slot').forEach(s => s.classList.remove('selected'));
    if(el) el.classList.add('selected');
};
window.abrirMochila = () => alert("🎒 Mochila em breve!");
window.toggleMenu = () => { const m = document.getElementById('settings-menu'); m.style.display = (m.style.display==='block'?'none':'block'); };

const conf = (id, fn) => document.getElementById(id).addEventListener('touchstart', e => { e.preventDefault(); fn(); });
conf('jump-button', () => { if(player.noChao) player.vel.y = 0.25; });
conf('build-button', () => interagir(false));
conf('delete-button', () => interagir(true));

function interagir(deletar) {
    if (!podeInteragir) return;
    const ray = new THREE.Raycaster(); ray.setFromCamera(new THREE.Vector2(0,0), camera);
    const hits = ray.intersectObjects(meshesParaInteracao);
    if (hits.length > 0) {
        const h = hits[0];
        if (deletar) {
            scene.remove(h.object);
            blocks = blocks.filter(b => b.mesh !== h.object);
            delete worldData.blocks[`${h.object.position.x},${h.object.position.y},${h.object.position.z}`];
        } else {
            const nP = h.object.position.clone().add(h.face.normal);
            const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat[blocoAtual]);
            mesh.position.set(Math.round(nP.x), Math.round(nP.y), Math.round(nP.z));
            scene.add(mesh);
            blocks.push({ mesh, box: new THREE.Box3().setFromObject(mesh) });
            meshesParaInteracao.push(mesh);
        }
        podeInteragir = false; setTimeout(() => podeInteragir = true, 250);
    }
}

// 8. LOOP FINAL
let frameCount = 0;
function animate() {
    requestAnimationFrame(animate);
    frameCount++;
    const cx = Math.floor(player.pos.x/10), cz = Math.floor(player.pos.z/10);
    for(let i=-renderDistance; i<=renderDistance; i++) for(let j=-renderDistance; j<=renderDistance; j++) gerarChunk(cx+i, cz+j);
    if (frameCount % 60 === 0) limparChunks();
    updateFisica();
    nuvens.forEach(n => { n.position.x += 0.02; if(n.position.x > player.pos.x+100) n.position.x = player.pos.x-100; });
    sunMesh.position.set(player.pos.x + 50, 100, player.pos.z - 50);
    camera.position.copy(player.pos).y += 0.6;
    camera.rotation.set(rotX, rotY, 0);
    renderer.render(scene, camera);
}
animate();
