import React, { useEffect, useMemo, useRef, useState } from "react";

/**
 * Controls the visual for Crash multipliers.
 */
const UNBOUNDED_PROGRESS_EXPONENT = 0.5;
const FOLLOW_RATE = 14;
const EPSILON = 0.00025;

/**
 * A fixed cubic Bézier route.
 */
const ROUTE = {
  start: { x: 105, y: 335 },
  controlOne: { x: 310, y: 335 },
  controlTwo: { x: 635, y: 245 },
  end: { x: 900, y: 65 },
};

const ROUTE_PATH = "M 105 335 C 310 335, 635 245, 900 65";

/**
 * Converts an official multiplier into a visual progress value from 0 to 1.
 */
function multiplierToProgress(multiplier) {
  const safeMultiplier = Math.max(1, Number(multiplier) || 1);

  return clamp(
    1 - Math.pow(safeMultiplier, -UNBOUNDED_PROGRESS_EXPONENT),
    0,
    0.995
  );
}

/** Returns the position on the route at the provided progress. */
function getBezierPoint(progress) {
  const inverse = 1 - progress;
  const inverseSquared = inverse * inverse;
  const progressSquared = progress * progress;

  return {
    x:
      inverseSquared * inverse * ROUTE.start.x +
      3 * inverseSquared * progress * ROUTE.controlOne.x +
      3 * inverse * progressSquared * ROUTE.controlTwo.x +
      progressSquared * progress * ROUTE.end.x,
    y:
      inverseSquared * inverse * ROUTE.start.y +
      3 * inverseSquared * progress * ROUTE.controlOne.y +
      3 * inverse * progressSquared * ROUTE.controlTwo.y +
      progressSquared * progress * ROUTE.end.y,
  };
}

/** Returns the tangent direction of the route for rocket rotation. */
function getBezierDirection(progress) {
  const inverse = 1 - progress;

  return {
    x:
      3 * inverse * inverse * (ROUTE.controlOne.x - ROUTE.start.x) +
      6 * inverse * progress * (ROUTE.controlTwo.x - ROUTE.controlOne.x) +
      3 * progress * progress * (ROUTE.end.x - ROUTE.controlTwo.x),
    y:
      3 * inverse * inverse * (ROUTE.controlOne.y - ROUTE.start.y) +
      6 * inverse * progress * (ROUTE.controlTwo.y - ROUTE.controlOne.y) +
      3 * progress * progress * (ROUTE.end.y - ROUTE.controlTwo.y),
  };
}

/** Converts route progress into SVG transform values. */
function getRocketTransform(progress) {
  const point = getBezierPoint(progress);
  const direction = getBezierDirection(progress);

  return {
    x: point.x,
    y: point.y,
    angle: (Math.atan2(direction.y, direction.x) * 180) / Math.PI,
    scale: 0.84 + progress * 0.34,
  };
}

/**
 * Shows milestone labels derived from the same mapping used by the rocket.
 */
function CrashFlightMilestones() {
  const values = [1, 2, 10, 100];

  return (
    <g className="crash-flight-milestones">
      {values.map((value) => {
        const point = getBezierPoint(multiplierToProgress(value));
        const labelY = Math.min(395, point.y + 38);

        return (
          <text
            key={value}
            x={point.x}
            y={labelY}
            textAnchor="middle"
          >
            {value.toFixed(2)}x
          </text>
        );
      })}
    </g>
  );
}

/**
 * Fixed flight visual for the Crash game.
 *
 * The multiplier prop must be the latest value received from Socket.IO.
 */
export default function CrashFlightVisual({
  phase,
  multiplier,
  crashPoint,
  secondsLeft,
  roundId,
}) {
  const targetProgressRef = useRef(0);
  const visibleProgressRef = useRef(0);
  const [visibleProgress, setVisibleProgress] = useState(0);

  const serverProgress = useMemo(
    () => multiplierToProgress(multiplier),
    [multiplier]
  );

  /** Reset the rocket during the waiting state. */
  useEffect(() => {
    if (["waiting", "initial", "booting"].includes(phase)) {
      targetProgressRef.current = 0;
      visibleProgressRef.current = 0;
      setVisibleProgress(0);
    }
  }, [phase]);

  /** Align the visual immediately when a new active round is identified. */
  useEffect(() => {
    if (!roundId) {
      return;
    }

    const initialProgress =
      phase === "active" || phase === "crashed" ? serverProgress : 0;

    targetProgressRef.current = initialProgress;
    visibleProgressRef.current = initialProgress;
    setVisibleProgress(initialProgress);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundId]);

  /** Receives the next visual target from the current server multiplier. */
  useEffect(() => {
    if (phase === "crashed") {
      targetProgressRef.current = serverProgress;
      visibleProgressRef.current = serverProgress;
      setVisibleProgress(serverProgress);
      return;
    }

    if (phase === "active") {
      targetProgressRef.current = Math.max(
        visibleProgressRef.current,
        serverProgress
      );
    }
  }, [phase, serverProgress]);

  /** Smooths only the illustration between server updates. */
  useEffect(() => {
    if (phase !== "active") {
      return undefined;
    }

    let frameId;
    let previousTime = performance.now();

    function animate(currentTime) {
      const elapsedSeconds = Math.min(
        0.1,
        (currentTime - previousTime) / 1000
      );
      previousTime = currentTime;

      const current = visibleProgressRef.current;
      const target = Math.max(current, targetProgressRef.current);
      const difference = target - current;

      if (difference > EPSILON) {
        const amount = 1 - Math.exp(-FOLLOW_RATE * elapsedSeconds);
        const next = Math.min(target, current + difference * amount);

        visibleProgressRef.current = next;
        setVisibleProgress(next);
      }

      frameId = requestAnimationFrame(animate);
    }

    frameId = requestAnimationFrame(animate);

    return () => cancelAnimationFrame(frameId);
  }, [phase]);

  const rocket = useMemo(
    () => getRocketTransform(visibleProgress),
    [visibleProgress]
  );

  const rocketTransform = [
    `translate(${rocket.x} ${rocket.y})`,
    `rotate(${rocket.angle})`,
    `scale(${rocket.scale})`,
  ].join(" ");

  return (
    <section
      className={`crash-flight crash-flight--${phase}`}
      aria-label="Crash round visual"
    >
      <div className="crash-flight-hud">
        <div className="crash-flight-status" aria-live="polite">
          {phase === "waiting" && (
            <span className="crash-flight-status--waiting">
              Next round starts in <strong>{secondsLeft ?? "?"}s</strong>
            </span>
          )}

          {phase === "active" && (
            <span className="crash-flight-status--active">Round active</span>
          )}

          {phase === "crashed" && (
            <span className="crash-flight-status--crashed">
              Crashed at {Number(crashPoint || 1).toFixed(2)}x
            </span>
          )}
        </div>

        <div
          className="crash-flight-multiplier"
          aria-label={`Official server multiplier: ${Number(multiplier).toFixed(
            2
          )}x`}
        >
          {Number(multiplier).toFixed(2)}x
        </div>
      </div>

      <svg
        className="crash-flight-svg"
        viewBox="0 0 1000 420"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <linearGradient id="crash-flight-background" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor="#0d1117" />
            <stop offset="100%" stopColor="#101b31" />
          </linearGradient>

          <linearGradient id="crash-flight-route" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor="#2ea043" />
            <stop offset="100%" stopColor="#58a6ff" />
          </linearGradient>

          <radialGradient id="crash-flight-glow">
            <stop offset="0%" stopColor="#58a6ff" stopOpacity="0.34" />
            <stop offset="100%" stopColor="#58a6ff" stopOpacity="0" />
          </radialGradient>

          <pattern
            id="crash-flight-grid"
            width="44"
            height="44"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 44 0 L 0 0 0 44"
              fill="none"
              stroke="#8b949e"
              strokeOpacity="0.18"
              strokeWidth="1"
            />
          </pattern>
        </defs>

        <rect width="1000" height="420" fill="url(#crash-flight-background)" />
        <rect width="1000" height="420" fill="url(#crash-flight-grid)" />
        <ellipse cx="820" cy="80" rx="250" ry="190" fill="url(#crash-flight-glow)" />

        <path d={ROUTE_PATH} className="crash-flight-route-glow" />
        <path d={ROUTE_PATH} className="crash-flight-route-line" />

        <CrashFlightMilestones />

        {phase === "crashed" && (
          <g
            className="crash-flight-explosion"
            transform={`translate(${rocket.x} ${rocket.y})`}
          >
            <circle r="34" className="crash-flight-explosion-core" />
            <path
              d="M 0 -64 L 10 -20 L 47 -47 L 20 -10 L 64 0 L 20 10 L 47 47 L 10 20 L 0 64 L -10 20 L -47 47 L -20 10 L -64 0 L -20 -10 L -47 -47 L -10 -20 Z"
              className="crash-flight-explosion-rays"
            />
          </g>
        )}

        <g
          className={`crash-flight-rocket ${
            phase === "crashed" ? "crash-flight-rocket--crashed" : ""
          }`}
          transform={rocketTransform}
        >
          <path
            className="crash-flight-flame"
            d="M -47 0 C -35 -14 -22 -14 -10 0 C -22 14 -35 14 -47 0 Z"
          />
          <path className="crash-flight-rocket-fin" d="M -13 14 L -27 34 L 5 18 Z" />
          <path className="crash-flight-rocket-fin" d="M -13 -14 L -27 -34 L 5 -18 Z" />
          <path
            className="crash-flight-rocket-body"
            d="M -31 0 C -4 -25 22 -22 44 0 C 22 22 -4 25 -31 0 Z"
          />
          <circle className="crash-flight-rocket-window" cx="18" cy="0" r="9" />
        </g>
      </svg>
    </section>
  );
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}
