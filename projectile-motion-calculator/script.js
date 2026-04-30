(function () {
    const $ = (sel) => document.querySelector(sel);

    // DOM refs
    const velocityInput = $("#velocity");
    const velocitySlider = $("#velocitySlider");
    const angleInput = $("#angle");
    const angleSlider = $("#angleSlider");
    const heightInput = $("#height");
    const heightSlider = $("#heightSlider");
    const gravitySelect = $("#gravity");
    const btnCalculate = $("#btnCalculate");
    const btnAnimate = $("#btnAnimate");
    const btnReset = $("#btnReset");
    const canvas = $("#trajectoryCanvas");
    const ctx = canvas.getContext("2d");

    const resultEls = {
        range: $("#resRange"),
        maxHeight: $("#resMaxHeight"),
        time: $("#resTime"),
        impactV: $("#resImpactV"),
        vx: $("#resVx"),
        vy: $("#resVy"),
    };

    let animationId = null;
    let trajectoryPoints = [];

    // Sync slider <-> number input
    function syncInputs(numInput, slider) {
        numInput.addEventListener("input", () => {
            slider.value = numInput.value;
        });
        slider.addEventListener("input", () => {
            numInput.value = slider.value;
        });
    }

    syncInputs(velocityInput, velocitySlider);
    syncInputs(angleInput, angleSlider);
    syncInputs(heightInput, heightSlider);

    // Physics calculations
    function calculate() {
        const v0 = parseFloat(velocityInput.value) || 0;
        const angleDeg = parseFloat(angleInput.value) || 0;
        const h0 = parseFloat(heightInput.value) || 0;
        const g = parseFloat(gravitySelect.value);
        const theta = (angleDeg * Math.PI) / 180;

        const vx = v0 * Math.cos(theta);
        const vy = v0 * Math.sin(theta);

        let totalTime, range, maxHeight;

        if (g === 0) {
            // Zero gravity: projectile travels in a straight line forever — cap at 10s
            totalTime = 10;
            range = vx * totalTime;
            maxHeight = h0 + vy * totalTime;
        } else {
            // Quadratic: h0 + vy*t - 0.5*g*t^2 = 0
            const discriminant = vy * vy + 2 * g * h0;
            totalTime = (vy + Math.sqrt(Math.max(0, discriminant))) / g;
            range = vx * totalTime;
            maxHeight = h0 + (vy * vy) / (2 * g);
        }

        // Impact velocity
        const vyImpact = g === 0 ? vy : vy - g * totalTime;
        const impactSpeed = Math.sqrt(vx * vx + vyImpact * vyImpact);

        // Generate trajectory points
        trajectoryPoints = [];
        const steps = 300;
        const dt = totalTime / steps;
        for (let i = 0; i <= steps; i++) {
            const t = i * dt;
            const x = vx * t;
            const y = h0 + vy * t - 0.5 * g * t * t;
            trajectoryPoints.push({ x, y: Math.max(0, y), t });
        }

        return { range, maxHeight, totalTime, impactSpeed, vx, vy, h0, g, theta, v0 };
    }

    function displayResults(results) {
        resultEls.range.textContent = results.range.toFixed(2);
        resultEls.maxHeight.textContent = results.maxHeight.toFixed(2);
        resultEls.time.textContent = results.totalTime.toFixed(2);
        resultEls.impactV.textContent = results.impactSpeed.toFixed(2);
        resultEls.vx.textContent = results.vx.toFixed(2);
        resultEls.vy.textContent = results.vy.toFixed(2);

        document.querySelectorAll(".result-card").forEach((card) => {
            card.classList.add("highlight");
            setTimeout(() => card.classList.remove("highlight"), 600);
        });
    }

    // Canvas drawing
    function resizeCanvas() {
        const wrapper = canvas.parentElement;
        canvas.width = wrapper.clientWidth;
        canvas.height = 400;
    }

    function drawTrajectory(pointsToDraw) {
        resizeCanvas();
        const w = canvas.width;
        const h = canvas.height;
        const pad = { top: 30, right: 30, bottom: 50, left: 60 };
        const plotW = w - pad.left - pad.right;
        const plotH = h - pad.top - pad.bottom;

        ctx.clearRect(0, 0, w, h);

        if (pointsToDraw.length === 0) {
            ctx.fillStyle = "#94a3b8";
            ctx.font = "16px system-ui";
            ctx.textAlign = "center";
            ctx.fillText('Press "Calculate" to see the trajectory', w / 2, h / 2);
            return;
        }

        // Find data bounds
        let maxX = 0;
        let maxY = 0;
        for (const p of trajectoryPoints) {
            if (p.x > maxX) maxX = p.x;
            if (p.y > maxY) maxY = p.y;
        }
        maxX = maxX || 1;
        maxY = maxY || 1;
        // Add 10% padding to data range
        maxX *= 1.1;
        maxY *= 1.15;

        const scaleX = plotW / maxX;
        const scaleY = plotH / maxY;

        function toCanvasX(x) {
            return pad.left + x * scaleX;
        }
        function toCanvasY(y) {
            return pad.top + plotH - y * scaleY;
        }

        // Grid lines
        ctx.strokeStyle = "#1e3a5f";
        ctx.lineWidth = 0.5;
        const gridLinesX = 8;
        const gridLinesY = 6;

        for (let i = 0; i <= gridLinesX; i++) {
            const val = (maxX / gridLinesX) * i;
            const cx = toCanvasX(val);
            ctx.beginPath();
            ctx.moveTo(cx, pad.top);
            ctx.lineTo(cx, pad.top + plotH);
            ctx.stroke();
        }

        for (let i = 0; i <= gridLinesY; i++) {
            const val = (maxY / gridLinesY) * i;
            const cy = toCanvasY(val);
            ctx.beginPath();
            ctx.moveTo(pad.left, cy);
            ctx.lineTo(pad.left + plotW, cy);
            ctx.stroke();
        }

        // Axes
        ctx.strokeStyle = "#475569";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(pad.left, pad.top);
        ctx.lineTo(pad.left, pad.top + plotH);
        ctx.lineTo(pad.left + plotW, pad.top + plotH);
        ctx.stroke();

        // Axis labels
        ctx.fillStyle = "#94a3b8";
        ctx.font = "12px system-ui";
        ctx.textAlign = "center";

        for (let i = 0; i <= gridLinesX; i++) {
            const val = (maxX / gridLinesX) * i;
            ctx.fillText(val.toFixed(0), toCanvasX(val), pad.top + plotH + 20);
        }

        ctx.textAlign = "right";
        for (let i = 0; i <= gridLinesY; i++) {
            const val = (maxY / gridLinesY) * i;
            ctx.fillText(val.toFixed(1), pad.left - 8, toCanvasY(val) + 4);
        }

        // Axis titles
        ctx.fillStyle = "#94a3b8";
        ctx.font = "13px system-ui";
        ctx.textAlign = "center";
        ctx.fillText("Distance (m)", pad.left + plotW / 2, h - 5);

        ctx.save();
        ctx.translate(15, pad.top + plotH / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText("Height (m)", 0, 0);
        ctx.restore();

        // Trajectory path
        ctx.beginPath();
        ctx.strokeStyle = "#2563eb";
        ctx.lineWidth = 2.5;
        ctx.shadowColor = "#2563eb";
        ctx.shadowBlur = 8;
        for (let i = 0; i < pointsToDraw.length; i++) {
            const p = pointsToDraw[i];
            const cx = toCanvasX(p.x);
            const cy = toCanvasY(p.y);
            if (i === 0) ctx.moveTo(cx, cy);
            else ctx.lineTo(cx, cy);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Start point
        const startP = pointsToDraw[0];
        ctx.beginPath();
        ctx.arc(toCanvasX(startP.x), toCanvasY(startP.y), 5, 0, Math.PI * 2);
        ctx.fillStyle = "#10b981";
        ctx.fill();

        // End point
        if (pointsToDraw.length > 1) {
            const endP = pointsToDraw[pointsToDraw.length - 1];
            ctx.beginPath();
            ctx.arc(toCanvasX(endP.x), toCanvasY(endP.y), 5, 0, Math.PI * 2);
            ctx.fillStyle = "#ef4444";
            ctx.fill();
        }

        // Max height marker
        let maxPt = pointsToDraw[0];
        for (const p of pointsToDraw) {
            if (p.y > maxPt.y) maxPt = p;
        }
        ctx.beginPath();
        ctx.arc(toCanvasX(maxPt.x), toCanvasY(maxPt.y), 4, 0, Math.PI * 2);
        ctx.fillStyle = "#f59e0b";
        ctx.fill();
        ctx.fillStyle = "#f59e0b";
        ctx.font = "11px system-ui";
        ctx.textAlign = "center";
        ctx.fillText(
            `Peak: ${maxPt.y.toFixed(1)}m`,
            toCanvasX(maxPt.x),
            toCanvasY(maxPt.y) - 12
        );
    }

    // Animation
    function animateTrajectory() {
        cancelAnimation();
        const results = calculate();
        displayResults(results);

        let frame = 0;
        const totalFrames = trajectoryPoints.length;

        function step() {
            frame += 2;
            if (frame > totalFrames) frame = totalFrames;

            const partial = trajectoryPoints.slice(0, frame);
            drawTrajectory(partial);

            // Draw moving ball at current position
            if (partial.length > 0) {
                const current = partial[partial.length - 1];
                const w = canvas.width;
                const h = canvas.height;
                const padL = 60, padR = 30, padT = 30, padB = 50;
                const plotW = w - padL - padR;
                const plotH = h - padT - padB;

                let maxX = 0, maxY = 0;
                for (const p of trajectoryPoints) {
                    if (p.x > maxX) maxX = p.x;
                    if (p.y > maxY) maxY = p.y;
                }
                maxX = (maxX || 1) * 1.1;
                maxY = (maxY || 1) * 1.15;

                const cx = padL + (current.x / maxX) * plotW;
                const cy = padT + plotH - (current.y / maxY) * plotH;

                // Glow
                ctx.beginPath();
                ctx.arc(cx, cy, 10, 0, Math.PI * 2);
                ctx.fillStyle = "rgba(37, 99, 235, 0.3)";
                ctx.fill();

                // Ball
                ctx.beginPath();
                ctx.arc(cx, cy, 6, 0, Math.PI * 2);
                ctx.fillStyle = "#60a5fa";
                ctx.fill();
                ctx.strokeStyle = "#fff";
                ctx.lineWidth = 1.5;
                ctx.stroke();
            }

            if (frame < totalFrames) {
                animationId = requestAnimationFrame(step);
            }
        }

        animationId = requestAnimationFrame(step);
    }

    function cancelAnimation() {
        if (animationId) {
            cancelAnimationFrame(animationId);
            animationId = null;
        }
    }

    // Event handlers
    btnCalculate.addEventListener("click", () => {
        cancelAnimation();
        const results = calculate();
        displayResults(results);
        drawTrajectory(trajectoryPoints);
    });

    btnAnimate.addEventListener("click", () => {
        animateTrajectory();
    });

    btnReset.addEventListener("click", () => {
        cancelAnimation();
        velocityInput.value = 50;
        velocitySlider.value = 50;
        angleInput.value = 45;
        angleSlider.value = 45;
        heightInput.value = 0;
        heightSlider.value = 0;
        gravitySelect.value = "9.81";

        resultEls.range.textContent = "—";
        resultEls.maxHeight.textContent = "—";
        resultEls.time.textContent = "—";
        resultEls.impactV.textContent = "—";
        resultEls.vx.textContent = "—";
        resultEls.vy.textContent = "—";

        trajectoryPoints = [];
        resizeCanvas();
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#94a3b8";
        ctx.font = "16px system-ui";
        ctx.textAlign = "center";
        ctx.fillText(
            'Press "Calculate" to see the trajectory',
            canvas.width / 2,
            canvas.height / 2
        );
    });

    // Resize handler
    window.addEventListener("resize", () => {
        if (trajectoryPoints.length > 0) {
            drawTrajectory(trajectoryPoints);
        } else {
            resizeCanvas();
            ctx.fillStyle = "#94a3b8";
            ctx.font = "16px system-ui";
            ctx.textAlign = "center";
            ctx.fillText(
                'Press "Calculate" to see the trajectory',
                canvas.width / 2,
                canvas.height / 2
            );
        }
    });

    // Initial canvas draw
    resizeCanvas();
    ctx.fillStyle = "#94a3b8";
    ctx.font = "16px system-ui";
    ctx.textAlign = "center";
    ctx.fillText(
        'Press "Calculate" to see the trajectory',
        canvas.width / 2,
        canvas.height / 2
    );
})();
