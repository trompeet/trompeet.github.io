// CANVAS ANIMATION SYSTEM
const STEP_LENGTH = 1;
const CELL_SIZE = 10;
const BORDER_WIDTH = 2;
const MAX_ELECTRONS = 150;
const CELL_DISTANCE = CELL_SIZE + BORDER_WIDTH;
const CELL_REPAINT_INTERVAL = [300, 500];
const BG_COLOR = "#1d2227";
const BORDER_COLOR = "#13191f";
const CELL_HIGHLIGHT = "#ffffff";
const ELECTRON_COLOR = "#ffffff";
const DPR = window.devicePixelRatio || 1;
const ACTIVE_ELECTRONS = [];
const PINNED_CELLS = [];
const MOVE_TRAILS = [
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
].map(([x, y]) => [x * CELL_DISTANCE, y * CELL_DISTANCE]);
const END_POINTS_OFFSET = [
    [0, 0],
    [0, 1],
    [1, 0],
    [1, 1],
].map(([x, y]) => [x * CELL_DISTANCE - BORDER_WIDTH / 2, y * CELL_DISTANCE - BORDER_WIDTH / 2]);

class FullscreenCanvas {
    constructor(disableScale = false) {
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");

        this.canvas = canvas;
        this.context = context;
        this.disableScale = disableScale;

        this.resizeHandlers = [];
        this.handleResize = debounce(this.handleResize.bind(this), 100);

        this.adjust();

        window.addEventListener("resize", this.handleResize);
    }

    adjust() {
        const { canvas, context, disableScale } = this;
        const { innerWidth, innerHeight } = window;

        this.width = innerWidth;
        this.height = innerHeight;

        const scale = disableScale ? 1 : DPR;

        this.realWidth = canvas.width = innerWidth * scale;
        this.realHeight = canvas.height = innerHeight * scale;

        canvas.style.width = `${innerWidth}px`;
        canvas.style.height = `${innerHeight}px`;

        context.scale(scale, scale);
    }

    clear() {
        const { context } = this;
        context.clearRect(0, 0, this.width, this.height);
    }

    makeCallback(fn) {
        fn(this.context, this);
    }

    blendBackground(background, opacity = 0.05) {
        return this.paint((ctx, { realWidth, realHeight, width, height }) => {
            ctx.globalCompositeOperation = "source-over";
            ctx.globalAlpha = opacity;

            ctx.drawImage(background, 0, 0, realWidth, realHeight, 0, 0, width, height);
        });
    }

    paint(fn) {
        if (typeof fn !== "function") return;

        const { context } = this;
        context.save();
        this.makeCallback(fn);
        context.restore();

        return this;
    }

    repaint(fn) {
        if (typeof fn !== "function") return;

        this.clear();

        return this.paint(fn);
    }

    onResize(fn) {
        if (typeof fn !== "function") return;

        this.resizeHandlers.push(fn);
    }

    handleResize() {
        const { resizeHandlers } = this;

        if (!resizeHandlers.length) return;

        this.adjust();

        resizeHandlers.forEach(this.makeCallback.bind(this));
    }

    renderIntoView(target = document.body) {
        const { canvas } = this;

        this.container = target;

        canvas.style.position = "absolute";
        canvas.style.left = "0px";
        canvas.style.top = "0px";

        target.appendChild(canvas);
    }
}

class Electron {
    constructor(x = 0, y = 0, { lifeTime = 3 * 1e3, speed = STEP_LENGTH, color = ELECTRON_COLOR } = {}) {
        this.lifeTime = lifeTime;
        this.expireAt = Date.now() + lifeTime;

        this.speed = speed;
        this.color = color;

        this.radius = BORDER_WIDTH / 2;
        this.current = [x, y];
        this.visited = {};
        this.setDest(this.randomPath());
    }

    randomPath() {
        const {
            current: [x, y],
        } = this;
        const { length } = MOVE_TRAILS;
        const [deltaX, deltaY] = MOVE_TRAILS[Math.floor(Math.random() * length)];

        return [x + deltaX, y + deltaY];
    }

    static composeCoord(coord) {
        return coord.join(",");
    }

    hasVisited(dest) {
        const key = Electron.composeCoord(dest);

        return this.visited[key];
    }

    setDest(dest) {
        this.destination = dest;
        this.visited[Electron.composeCoord(dest)] = true;
    }

    next() {
        let { speed, current, destination } = this;

        if (Math.abs(current[0] - destination[0]) <= speed / 2 && Math.abs(current[1] - destination[1]) <= speed / 2) {
            destination = this.randomPath();

            let tryCnt = 1;
            const maxAttempt = 4;

            while (this.hasVisited(destination) && tryCnt <= maxAttempt) {
                tryCnt++;
                destination = this.randomPath();
            }

            this.setDest(destination);
        }

        const deltaX = destination[0] - current[0];
        const deltaY = destination[1] - current[1];

        if (deltaX) {
            current[0] += (deltaX / Math.abs(deltaX)) * speed;
        }

        if (deltaY) {
            current[1] += (deltaY / Math.abs(deltaY)) * speed;
        }

        return [...this.current];
    }

    paintNextTo(layer = new FullscreenCanvas()) {
        const { radius, color, expireAt, lifeTime } = this;
        const [x, y] = this.next();

        layer.paint((ctx) => {
            ctx.globalAlpha = Math.max(0, expireAt - Date.now()) / lifeTime;
            ctx.fillStyle = color;
            ctx.shadowColor = color;
            ctx.shadowBlur = radius * 5;
            ctx.globalCompositeOperation = "lighter";

            ctx.beginPath();
            ctx.arc(x, y, radius, 0, Math.PI * 2);
            ctx.closePath();

            ctx.fill();
        });
    }
}

class Cell {
    constructor(row = 0, col = 0, { electronCount = 1 + Math.floor(Math.random() * 4), background = ELECTRON_COLOR, forceElectrons = false, electronOptions = {} } = {}) {
        this.background = background;
        this.electronOptions = electronOptions;
        this.forceElectrons = forceElectrons;
        this.electronCount = Math.min(electronCount, 4);

        this.startY = row * CELL_DISTANCE;
        this.startX = col * CELL_DISTANCE;
    }

    delay(ms = 0) {
        this.pin(ms * 1.5);
        this.nextUpdate = Date.now() + ms;
    }

    pin(lifeTime = -1 >>> 1) {
        this.expireAt = Date.now() + lifeTime;

        PINNED_CELLS.push(this);
    }

    scheduleUpdate(t1 = CELL_REPAINT_INTERVAL[0], t2 = CELL_REPAINT_INTERVAL[1]) {
        this.nextUpdate = Date.now() + t1 + Math.floor(Math.random() * (t2 - t1 + 1));
    }

    paintNextTo(layer = new FullscreenCanvas()) {
        const { startX, startY, background, nextUpdate } = this;

        if (nextUpdate && Date.now() < nextUpdate) return;

        this.scheduleUpdate();
        this.createElectrons();

        layer.paint((ctx) => {
            ctx.globalCompositeOperation = "lighter";
            ctx.fillStyle = background;
            ctx.fillRect(startX, startY, CELL_SIZE, CELL_SIZE);
        });
    }

    static popRandom(arr = []) {
        const ramIdx = Math.floor(Math.random() * arr.length);

        return arr.splice(ramIdx, 1)[0];
    }

    createElectrons() {
        const { startX, startY, electronCount, electronOptions, forceElectrons } = this;

        if (!electronCount) return;

        const endpoints = [...END_POINTS_OFFSET];

        const max = forceElectrons ? electronCount : Math.min(electronCount, MAX_ELECTRONS - ACTIVE_ELECTRONS.length);

        for (let i = 0; i < max; i++) {
            const [offsetX, offsetY] = Cell.popRandom(endpoints);

            ACTIVE_ELECTRONS.push(new Electron(startX + offsetX, startY + offsetY, electronOptions));
        }
    }
}

const bgLayer = new FullscreenCanvas();
const mainLayer = new FullscreenCanvas();

function createRandomCell(options = {}) {
    if (ACTIVE_ELECTRONS.length >= MAX_ELECTRONS) return;

    const { width, height } = mainLayer;

    const cell = new Cell(Math.floor(Math.random() * (height / CELL_DISTANCE + 1)), Math.floor(Math.random() * (width / CELL_DISTANCE + 1)), options);

    cell.paintNextTo(mainLayer);
}

function drawGrid() {
    bgLayer.paint((ctx, { width, height }) => {
        ctx.fillStyle = BG_COLOR;
        ctx.fillRect(0, 0, width, height);

        ctx.fillStyle = BORDER_COLOR;

        for (let h = CELL_SIZE; h < height; h += CELL_DISTANCE) {
            ctx.fillRect(0, h, width, BORDER_WIDTH);
        }

        for (let w = CELL_SIZE; w < width; w += CELL_DISTANCE) {
            ctx.fillRect(w, 0, BORDER_WIDTH, height);
        }
    });
}

function iterateItemsIn(list) {
    const now = Date.now();

    for (let i = 0, max = list.length; i < max; i++) {
        const item = list[i];

        if (now >= item.expireAt) {
            list.splice(i, 1);
            i--;
            max--;
        } else {
            item.paintNextTo(mainLayer);
        }
    }
}

function drawItems() {
    iterateItemsIn(PINNED_CELLS);
    iterateItemsIn(ACTIVE_ELECTRONS);
}

let nextRandomAt;

function activateRandom() {
    const now = Date.now();

    if (now < nextRandomAt) {
        return;
    }

    nextRandomAt = now + 300 + Math.floor(Math.random() * (1000 - 300 + 1));

    createRandomCell();
}

function prepaint() {
    drawGrid();

    mainLayer.paint((ctx, { width, height }) => {
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, width, height);
    });

    mainLayer.blendBackground(bgLayer.canvas, 0.9);
}

function render() {
    mainLayer.blendBackground(bgLayer.canvas);

    drawItems();
    activateRandom();

    requestAnimationFrame(render);
}

function debounce(func, wait, immediate) {
    let timeout;
    return function () {
        const context = this,
            args = arguments;
        const later = function () {
            timeout = null;
            if (!immediate) func.apply(context, args);
        };
        const callNow = immediate && !timeout;
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
        if (callNow) func.apply(context, args);
    };
}

// Initialize background animation
bgLayer.onResize(drawGrid);
mainLayer.onResize(prepaint);
mainLayer.renderIntoView(document.body);
prepaint();
render();

// Prevent zooming
document.addEventListener("touchmove", (e) => e.preventDefault());