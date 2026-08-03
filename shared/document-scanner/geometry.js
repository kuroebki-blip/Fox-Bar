(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.DocumentScannerGeometry = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function polygonArea(points) {
    return Math.abs(points.reduce((sum, point, index) => {
      const next = points[(index + 1) % points.length];
      return sum + point.x * next.y - next.x * point.y;
    }, 0) / 2);
  }
  function sortCorners(points) {
    if (!Array.isArray(points) || points.length !== 4) throw new Error('Нужно четыре угла документа.');
    const copy = points.map(point => ({ x: Number(point.x), y: Number(point.y) }));
    if (copy.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) throw new Error('Координаты углов повреждены.');
    const center = copy.reduce((sum, point) => ({ x: sum.x + point.x / 4, y: sum.y + point.y / 4 }), { x: 0, y: 0 });
    copy.sort((a, b) => Math.atan2(a.y - center.y, a.x - center.x) - Math.atan2(b.y - center.y, b.x - center.x));
    const start = copy.reduce((best, point, index) => point.x + point.y < copy[best].x + copy[best].y ? index : best, 0);
    const ordered = copy.slice(start).concat(copy.slice(0, start));
    if (ordered[1].x < ordered[3].x) [ordered[1], ordered[3]] = [ordered[3], ordered[1]];
    return { topLeft: ordered[0], topRight: ordered[1], bottomRight: ordered[2], bottomLeft: ordered[3] };
  }
  function isConvex(corners) {
    const points = Object.values(corners);
    let sign = 0;
    for (let index = 0; index < 4; index += 1) {
      const a = points[index], b = points[(index + 1) % 4], c = points[(index + 2) % 4];
      const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
      if (!cross) return false;
      if (!sign) sign = Math.sign(cross); else if (Math.sign(cross) !== sign) return false;
    }
    return polygonArea(points) > 1;
  }
  function outputSize(corners, maxLongSide) {
    const width = Math.max(distance(corners.topLeft, corners.topRight), distance(corners.bottomLeft, corners.bottomRight));
    const height = Math.max(distance(corners.topLeft, corners.bottomLeft), distance(corners.topRight, corners.bottomRight));
    const scale = Math.min(1, Number(maxLongSide || 2400) / Math.max(width, height));
    return { width: Math.max(2, Math.round(width * scale)), height: Math.max(2, Math.round(height * scale)) };
  }
  function scaleCorners(corners, scale) {
    return Object.fromEntries(Object.entries(corners).map(([key, point]) => [key, { x: point.x * scale, y: point.y * scale }]));
  }
  return { distance, polygonArea, sortCorners, isConvex, outputSize, scaleCorners };
});
