import "@testing-library/jest-dom";
import "dotenv/config";

// Polyfill HTMLCanvasElement.prototype.getContext for JSDOM
if (typeof window !== "undefined" && typeof HTMLCanvasElement !== "undefined") {
  HTMLCanvasElement.prototype.getContext = (() => {
    return {
      filter: "none",
      fillRect: () => {},
      clearRect: () => {},
      getImageData: () => ({ data: new Array(4) }),
      putImageData: () => {},
      createImageData: () => [],
      setTransform: () => {},
      drawImage: () => {},
      save: () => {},
      fillText: () => {},
      restore: () => {},
      beginPath: () => {},
      moveTo: () => {},
      lineTo: () => {},
      closePath: () => {},
      stroke: () => {},
      translate: () => {},
      scale: () => {},
      rotate: () => {},
      arc: () => {},
      fill: () => {},
      measureText: () => ({ width: 0 }),
      transform: () => {},
      rect: () => {},
      clip: () => {},
    };
  }) as unknown as typeof HTMLCanvasElement.prototype.getContext;
}
