var MapGen2 = (() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __commonJS = (cb, mod) => function __require() {
    try {
      return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    } catch (e) {
      throw mod = 0, e;
    }
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // node_modules/simplex-noise/simplex-noise.js
  var require_simplex_noise = __commonJS({
    "node_modules/simplex-noise/simplex-noise.js"(exports, module) {
      (function() {
        "use strict";
        var F2 = 0.5 * (Math.sqrt(3) - 1);
        var G2 = (3 - Math.sqrt(3)) / 6;
        var F3 = 1 / 3;
        var G3 = 1 / 6;
        var F4 = (Math.sqrt(5) - 1) / 4;
        var G4 = (5 - Math.sqrt(5)) / 20;
        function SimplexNoise2(randomOrSeed) {
          var random;
          if (typeof randomOrSeed == "function") {
            random = randomOrSeed;
          } else if (randomOrSeed) {
            random = alea(randomOrSeed);
          } else {
            random = Math.random;
          }
          this.p = buildPermutationTable(random);
          this.perm = new Uint8Array(512);
          this.permMod12 = new Uint8Array(512);
          for (var i = 0; i < 512; i++) {
            this.perm[i] = this.p[i & 255];
            this.permMod12[i] = this.perm[i] % 12;
          }
        }
        SimplexNoise2.prototype = {
          grad3: new Float32Array([
            1,
            1,
            0,
            -1,
            1,
            0,
            1,
            -1,
            0,
            -1,
            -1,
            0,
            1,
            0,
            1,
            -1,
            0,
            1,
            1,
            0,
            -1,
            -1,
            0,
            -1,
            0,
            1,
            1,
            0,
            -1,
            1,
            0,
            1,
            -1,
            0,
            -1,
            -1
          ]),
          grad4: new Float32Array([
            0,
            1,
            1,
            1,
            0,
            1,
            1,
            -1,
            0,
            1,
            -1,
            1,
            0,
            1,
            -1,
            -1,
            0,
            -1,
            1,
            1,
            0,
            -1,
            1,
            -1,
            0,
            -1,
            -1,
            1,
            0,
            -1,
            -1,
            -1,
            1,
            0,
            1,
            1,
            1,
            0,
            1,
            -1,
            1,
            0,
            -1,
            1,
            1,
            0,
            -1,
            -1,
            -1,
            0,
            1,
            1,
            -1,
            0,
            1,
            -1,
            -1,
            0,
            -1,
            1,
            -1,
            0,
            -1,
            -1,
            1,
            1,
            0,
            1,
            1,
            1,
            0,
            -1,
            1,
            -1,
            0,
            1,
            1,
            -1,
            0,
            -1,
            -1,
            1,
            0,
            1,
            -1,
            1,
            0,
            -1,
            -1,
            -1,
            0,
            1,
            -1,
            -1,
            0,
            -1,
            1,
            1,
            1,
            0,
            1,
            1,
            -1,
            0,
            1,
            -1,
            1,
            0,
            1,
            -1,
            -1,
            0,
            -1,
            1,
            1,
            0,
            -1,
            1,
            -1,
            0,
            -1,
            -1,
            1,
            0,
            -1,
            -1,
            -1,
            0
          ]),
          noise2D: function(xin, yin) {
            var permMod12 = this.permMod12;
            var perm = this.perm;
            var grad3 = this.grad3;
            var n0 = 0;
            var n1 = 0;
            var n2 = 0;
            var s = (xin + yin) * F2;
            var i = Math.floor(xin + s);
            var j = Math.floor(yin + s);
            var t = (i + j) * G2;
            var X0 = i - t;
            var Y0 = j - t;
            var x0 = xin - X0;
            var y0 = yin - Y0;
            var i1, j1;
            if (x0 > y0) {
              i1 = 1;
              j1 = 0;
            } else {
              i1 = 0;
              j1 = 1;
            }
            var x1 = x0 - i1 + G2;
            var y1 = y0 - j1 + G2;
            var x2 = x0 - 1 + 2 * G2;
            var y2 = y0 - 1 + 2 * G2;
            var ii = i & 255;
            var jj = j & 255;
            var t0 = 0.5 - x0 * x0 - y0 * y0;
            if (t0 >= 0) {
              var gi0 = permMod12[ii + perm[jj]] * 3;
              t0 *= t0;
              n0 = t0 * t0 * (grad3[gi0] * x0 + grad3[gi0 + 1] * y0);
            }
            var t1 = 0.5 - x1 * x1 - y1 * y1;
            if (t1 >= 0) {
              var gi1 = permMod12[ii + i1 + perm[jj + j1]] * 3;
              t1 *= t1;
              n1 = t1 * t1 * (grad3[gi1] * x1 + grad3[gi1 + 1] * y1);
            }
            var t2 = 0.5 - x2 * x2 - y2 * y2;
            if (t2 >= 0) {
              var gi2 = permMod12[ii + 1 + perm[jj + 1]] * 3;
              t2 *= t2;
              n2 = t2 * t2 * (grad3[gi2] * x2 + grad3[gi2 + 1] * y2);
            }
            return 70 * (n0 + n1 + n2);
          },
          // 3D simplex noise
          noise3D: function(xin, yin, zin) {
            var permMod12 = this.permMod12;
            var perm = this.perm;
            var grad3 = this.grad3;
            var n0, n1, n2, n3;
            var s = (xin + yin + zin) * F3;
            var i = Math.floor(xin + s);
            var j = Math.floor(yin + s);
            var k = Math.floor(zin + s);
            var t = (i + j + k) * G3;
            var X0 = i - t;
            var Y0 = j - t;
            var Z0 = k - t;
            var x0 = xin - X0;
            var y0 = yin - Y0;
            var z0 = zin - Z0;
            var i1, j1, k1;
            var i2, j2, k2;
            if (x0 >= y0) {
              if (y0 >= z0) {
                i1 = 1;
                j1 = 0;
                k1 = 0;
                i2 = 1;
                j2 = 1;
                k2 = 0;
              } else if (x0 >= z0) {
                i1 = 1;
                j1 = 0;
                k1 = 0;
                i2 = 1;
                j2 = 0;
                k2 = 1;
              } else {
                i1 = 0;
                j1 = 0;
                k1 = 1;
                i2 = 1;
                j2 = 0;
                k2 = 1;
              }
            } else {
              if (y0 < z0) {
                i1 = 0;
                j1 = 0;
                k1 = 1;
                i2 = 0;
                j2 = 1;
                k2 = 1;
              } else if (x0 < z0) {
                i1 = 0;
                j1 = 1;
                k1 = 0;
                i2 = 0;
                j2 = 1;
                k2 = 1;
              } else {
                i1 = 0;
                j1 = 1;
                k1 = 0;
                i2 = 1;
                j2 = 1;
                k2 = 0;
              }
            }
            var x1 = x0 - i1 + G3;
            var y1 = y0 - j1 + G3;
            var z1 = z0 - k1 + G3;
            var x2 = x0 - i2 + 2 * G3;
            var y2 = y0 - j2 + 2 * G3;
            var z2 = z0 - k2 + 2 * G3;
            var x3 = x0 - 1 + 3 * G3;
            var y3 = y0 - 1 + 3 * G3;
            var z3 = z0 - 1 + 3 * G3;
            var ii = i & 255;
            var jj = j & 255;
            var kk = k & 255;
            var t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
            if (t0 < 0) n0 = 0;
            else {
              var gi0 = permMod12[ii + perm[jj + perm[kk]]] * 3;
              t0 *= t0;
              n0 = t0 * t0 * (grad3[gi0] * x0 + grad3[gi0 + 1] * y0 + grad3[gi0 + 2] * z0);
            }
            var t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
            if (t1 < 0) n1 = 0;
            else {
              var gi1 = permMod12[ii + i1 + perm[jj + j1 + perm[kk + k1]]] * 3;
              t1 *= t1;
              n1 = t1 * t1 * (grad3[gi1] * x1 + grad3[gi1 + 1] * y1 + grad3[gi1 + 2] * z1);
            }
            var t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
            if (t2 < 0) n2 = 0;
            else {
              var gi2 = permMod12[ii + i2 + perm[jj + j2 + perm[kk + k2]]] * 3;
              t2 *= t2;
              n2 = t2 * t2 * (grad3[gi2] * x2 + grad3[gi2 + 1] * y2 + grad3[gi2 + 2] * z2);
            }
            var t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
            if (t3 < 0) n3 = 0;
            else {
              var gi3 = permMod12[ii + 1 + perm[jj + 1 + perm[kk + 1]]] * 3;
              t3 *= t3;
              n3 = t3 * t3 * (grad3[gi3] * x3 + grad3[gi3 + 1] * y3 + grad3[gi3 + 2] * z3);
            }
            return 32 * (n0 + n1 + n2 + n3);
          },
          // 4D simplex noise, better simplex rank ordering method 2012-03-09
          noise4D: function(x, y, z, w) {
            var perm = this.perm;
            var grad4 = this.grad4;
            var n0, n1, n2, n3, n4;
            var s = (x + y + z + w) * F4;
            var i = Math.floor(x + s);
            var j = Math.floor(y + s);
            var k = Math.floor(z + s);
            var l = Math.floor(w + s);
            var t = (i + j + k + l) * G4;
            var X0 = i - t;
            var Y0 = j - t;
            var Z0 = k - t;
            var W0 = l - t;
            var x0 = x - X0;
            var y0 = y - Y0;
            var z0 = z - Z0;
            var w0 = w - W0;
            var rankx = 0;
            var ranky = 0;
            var rankz = 0;
            var rankw = 0;
            if (x0 > y0) rankx++;
            else ranky++;
            if (x0 > z0) rankx++;
            else rankz++;
            if (x0 > w0) rankx++;
            else rankw++;
            if (y0 > z0) ranky++;
            else rankz++;
            if (y0 > w0) ranky++;
            else rankw++;
            if (z0 > w0) rankz++;
            else rankw++;
            var i1, j1, k1, l1;
            var i2, j2, k2, l2;
            var i3, j3, k3, l3;
            i1 = rankx >= 3 ? 1 : 0;
            j1 = ranky >= 3 ? 1 : 0;
            k1 = rankz >= 3 ? 1 : 0;
            l1 = rankw >= 3 ? 1 : 0;
            i2 = rankx >= 2 ? 1 : 0;
            j2 = ranky >= 2 ? 1 : 0;
            k2 = rankz >= 2 ? 1 : 0;
            l2 = rankw >= 2 ? 1 : 0;
            i3 = rankx >= 1 ? 1 : 0;
            j3 = ranky >= 1 ? 1 : 0;
            k3 = rankz >= 1 ? 1 : 0;
            l3 = rankw >= 1 ? 1 : 0;
            var x1 = x0 - i1 + G4;
            var y1 = y0 - j1 + G4;
            var z1 = z0 - k1 + G4;
            var w1 = w0 - l1 + G4;
            var x2 = x0 - i2 + 2 * G4;
            var y2 = y0 - j2 + 2 * G4;
            var z2 = z0 - k2 + 2 * G4;
            var w2 = w0 - l2 + 2 * G4;
            var x3 = x0 - i3 + 3 * G4;
            var y3 = y0 - j3 + 3 * G4;
            var z3 = z0 - k3 + 3 * G4;
            var w3 = w0 - l3 + 3 * G4;
            var x4 = x0 - 1 + 4 * G4;
            var y4 = y0 - 1 + 4 * G4;
            var z4 = z0 - 1 + 4 * G4;
            var w4 = w0 - 1 + 4 * G4;
            var ii = i & 255;
            var jj = j & 255;
            var kk = k & 255;
            var ll = l & 255;
            var t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0 - w0 * w0;
            if (t0 < 0) n0 = 0;
            else {
              var gi0 = perm[ii + perm[jj + perm[kk + perm[ll]]]] % 32 * 4;
              t0 *= t0;
              n0 = t0 * t0 * (grad4[gi0] * x0 + grad4[gi0 + 1] * y0 + grad4[gi0 + 2] * z0 + grad4[gi0 + 3] * w0);
            }
            var t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1 - w1 * w1;
            if (t1 < 0) n1 = 0;
            else {
              var gi1 = perm[ii + i1 + perm[jj + j1 + perm[kk + k1 + perm[ll + l1]]]] % 32 * 4;
              t1 *= t1;
              n1 = t1 * t1 * (grad4[gi1] * x1 + grad4[gi1 + 1] * y1 + grad4[gi1 + 2] * z1 + grad4[gi1 + 3] * w1);
            }
            var t2 = 0.6 - x2 * x2 - y2 * y2 - z2 * z2 - w2 * w2;
            if (t2 < 0) n2 = 0;
            else {
              var gi2 = perm[ii + i2 + perm[jj + j2 + perm[kk + k2 + perm[ll + l2]]]] % 32 * 4;
              t2 *= t2;
              n2 = t2 * t2 * (grad4[gi2] * x2 + grad4[gi2 + 1] * y2 + grad4[gi2 + 2] * z2 + grad4[gi2 + 3] * w2);
            }
            var t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3 - w3 * w3;
            if (t3 < 0) n3 = 0;
            else {
              var gi3 = perm[ii + i3 + perm[jj + j3 + perm[kk + k3 + perm[ll + l3]]]] % 32 * 4;
              t3 *= t3;
              n3 = t3 * t3 * (grad4[gi3] * x3 + grad4[gi3 + 1] * y3 + grad4[gi3 + 2] * z3 + grad4[gi3 + 3] * w3);
            }
            var t4 = 0.6 - x4 * x4 - y4 * y4 - z4 * z4 - w4 * w4;
            if (t4 < 0) n4 = 0;
            else {
              var gi4 = perm[ii + 1 + perm[jj + 1 + perm[kk + 1 + perm[ll + 1]]]] % 32 * 4;
              t4 *= t4;
              n4 = t4 * t4 * (grad4[gi4] * x4 + grad4[gi4 + 1] * y4 + grad4[gi4 + 2] * z4 + grad4[gi4 + 3] * w4);
            }
            return 27 * (n0 + n1 + n2 + n3 + n4);
          }
        };
        function buildPermutationTable(random) {
          var i;
          var p = new Uint8Array(256);
          for (i = 0; i < 256; i++) {
            p[i] = i;
          }
          for (i = 0; i < 255; i++) {
            var r = i + ~~(random() * (256 - i));
            var aux = p[i];
            p[i] = p[r];
            p[r] = aux;
          }
          return p;
        }
        SimplexNoise2._buildPermutationTable = buildPermutationTable;
        function alea() {
          var s0 = 0;
          var s1 = 0;
          var s2 = 0;
          var c = 1;
          var mash = masher();
          s0 = mash(" ");
          s1 = mash(" ");
          s2 = mash(" ");
          for (var i = 0; i < arguments.length; i++) {
            s0 -= mash(arguments[i]);
            if (s0 < 0) {
              s0 += 1;
            }
            s1 -= mash(arguments[i]);
            if (s1 < 0) {
              s1 += 1;
            }
            s2 -= mash(arguments[i]);
            if (s2 < 0) {
              s2 += 1;
            }
          }
          mash = null;
          return function() {
            var t = 2091639 * s0 + c * 23283064365386963e-26;
            s0 = s1;
            s1 = s2;
            return s2 = t - (c = t | 0);
          };
        }
        function masher() {
          var n = 4022871197;
          return function(data) {
            data = data.toString();
            for (var i = 0; i < data.length; i++) {
              n += data.charCodeAt(i);
              var h = 0.02519603282416938 * n;
              n = h >>> 0;
              h -= n;
              h *= n;
              n = h >>> 0;
              h -= n;
              n += h * 4294967296;
            }
            return (n >>> 0) * 23283064365386963e-26;
          };
        }
        if (typeof define !== "undefined" && define.amd) define(function() {
          return SimplexNoise2;
        });
        if (typeof exports !== "undefined") exports.SimplexNoise = SimplexNoise2;
        else if (typeof window !== "undefined") window.SimplexNoise = SimplexNoise2;
        if (typeof module !== "undefined") {
          module.exports = SimplexNoise2;
        }
      })();
    }
  });

  // node_modules/poisson-disk-sampling/src/tiny-ndarray.js
  var require_tiny_ndarray = __commonJS({
    "node_modules/poisson-disk-sampling/src/tiny-ndarray.js"(exports, module) {
      "use strict";
      function tinyNDArrayOfInteger(gridShape) {
        var dimensions = gridShape.length, totalLength = 1, stride = new Array(dimensions), dimension;
        for (dimension = dimensions; dimension > 0; dimension--) {
          stride[dimension - 1] = totalLength;
          totalLength = totalLength * gridShape[dimension - 1];
        }
        return {
          stride,
          data: new Uint32Array(totalLength)
        };
      }
      function tinyNDArrayOfArray(gridShape) {
        var dimensions = gridShape.length, totalLength = 1, stride = new Array(dimensions), data = [], dimension, index;
        for (dimension = dimensions; dimension > 0; dimension--) {
          stride[dimension - 1] = totalLength;
          totalLength = totalLength * gridShape[dimension - 1];
        }
        for (index = 0; index < totalLength; index++) {
          data.push([]);
        }
        return {
          stride,
          data
        };
      }
      module.exports = {
        integer: tinyNDArrayOfInteger,
        array: tinyNDArrayOfArray
      };
    }
  });

  // node_modules/poisson-disk-sampling/src/sphere-random.js
  var require_sphere_random = __commonJS({
    "node_modules/poisson-disk-sampling/src/sphere-random.js"(exports, module) {
      "use strict";
      module.exports = sampleSphere;
      function sampleSphere(d, rng) {
        var v2 = new Array(d), d2 = Math.floor(d / 2) << 1, r2 = 0, rr, r, theta, h, i;
        for (i = 0; i < d2; i += 2) {
          rr = -2 * Math.log(rng());
          r = Math.sqrt(rr);
          theta = 2 * Math.PI * rng();
          r2 += rr;
          v2[i] = r * Math.cos(theta);
          v2[i + 1] = r * Math.sin(theta);
        }
        if (d % 2) {
          var x = Math.sqrt(-2 * Math.log(rng())) * Math.cos(2 * Math.PI * rng());
          v2[d - 1] = x;
          r2 += Math.pow(x, 2);
        }
        h = 1 / Math.sqrt(r2);
        for (i = 0; i < d; ++i) {
          v2[i] *= h;
        }
        return v2;
      }
    }
  });

  // node_modules/moore/index.js
  var require_moore = __commonJS({
    "node_modules/moore/index.js"(exports, module) {
      module.exports = function moore(range, dimensions) {
        range = range || 1;
        dimensions = dimensions || 2;
        var size = range * 2 + 1;
        var length = Math.pow(size, dimensions) - 1;
        var neighbors = new Array(length);
        for (var i = 0; i < length; i++) {
          var neighbor = neighbors[i] = new Array(dimensions);
          var index = i < length / 2 ? i : i + 1;
          for (var dimension = 1; dimension <= dimensions; dimension++) {
            var value = index % Math.pow(size, dimension);
            neighbor[dimension - 1] = value / Math.pow(size, dimension - 1) - range;
            index -= value;
          }
        }
        return neighbors;
      };
    }
  });

  // node_modules/poisson-disk-sampling/src/neighbourhood.js
  var require_neighbourhood = __commonJS({
    "node_modules/poisson-disk-sampling/src/neighbourhood.js"(exports, module) {
      "use strict";
      var moore = require_moore();
      function getNeighbourhood(dimensionNumber) {
        var neighbourhood = moore(2, dimensionNumber), origin = [], dimension;
        neighbourhood = neighbourhood.filter(function(n) {
          var dist2 = 0;
          for (var d = 0; d < dimensionNumber; d++) {
            dist2 += Math.pow(Math.max(0, Math.abs(n[d]) - 1), 2);
          }
          return dist2 < dimensionNumber;
        });
        for (dimension = 0; dimension < dimensionNumber; dimension++) {
          origin.push(0);
        }
        neighbourhood.push(origin);
        neighbourhood.sort(function(n1, n2) {
          var squareDist1 = 0, squareDist2 = 0, dimension2;
          for (dimension2 = 0; dimension2 < dimensionNumber; dimension2++) {
            squareDist1 += Math.pow(n1[dimension2], 2);
            squareDist2 += Math.pow(n2[dimension2], 2);
          }
          if (squareDist1 < squareDist2) {
            return -1;
          } else if (squareDist1 > squareDist2) {
            return 1;
          } else {
            return 0;
          }
        });
        return neighbourhood;
      }
      var neighbourhoodCache = {};
      function getNeighbourhoodMemoized(dimensionNumber) {
        if (!neighbourhoodCache[dimensionNumber]) {
          neighbourhoodCache[dimensionNumber] = getNeighbourhood(dimensionNumber);
        }
        return neighbourhoodCache[dimensionNumber];
      }
      module.exports = getNeighbourhoodMemoized;
    }
  });

  // node_modules/poisson-disk-sampling/src/implementations/fixed-density.js
  var require_fixed_density = __commonJS({
    "node_modules/poisson-disk-sampling/src/implementations/fixed-density.js"(exports, module) {
      "use strict";
      var tinyNDArray = require_tiny_ndarray().integer;
      var sphereRandom = require_sphere_random();
      var getNeighbourhood = require_neighbourhood();
      function squaredEuclideanDistance(point1, point2) {
        var result = 0, i = 0;
        for (; i < point1.length; i++) {
          result += Math.pow(point1[i] - point2[i], 2);
        }
        return result;
      }
      function FixedDensityPDS(options, rng) {
        if (typeof options.distanceFunction === "function") {
          throw new Error("PoissonDiskSampling: Tried to instantiate the fixed density implementation with a distanceFunction");
        }
        this.shape = options.shape;
        this.minDistance = options.minDistance;
        this.maxDistance = options.maxDistance || options.minDistance * 2;
        this.maxTries = Math.ceil(Math.max(1, options.tries || 30));
        this.rng = rng || Math.random;
        var maxShape = 0;
        for (var i = 0; i < this.shape.length; i++) {
          maxShape = Math.max(maxShape, this.shape[i]);
        }
        var floatPrecisionMitigation = Math.max(1, maxShape / 128 | 0);
        var epsilonDistance = 1e-14 * floatPrecisionMitigation;
        this.dimension = this.shape.length;
        this.squaredMinDistance = this.minDistance * this.minDistance;
        this.minDistancePlusEpsilon = this.minDistance + epsilonDistance;
        this.deltaDistance = Math.max(0, this.maxDistance - this.minDistancePlusEpsilon);
        this.cellSize = this.minDistance / Math.sqrt(this.dimension);
        this.neighbourhood = getNeighbourhood(this.dimension);
        this.currentPoint = null;
        this.processList = [];
        this.samplePoints = [];
        this.gridShape = [];
        for (var i = 0; i < this.dimension; i++) {
          this.gridShape.push(Math.ceil(this.shape[i] / this.cellSize));
        }
        this.grid = tinyNDArray(this.gridShape);
      }
      FixedDensityPDS.prototype.shape = null;
      FixedDensityPDS.prototype.dimension = null;
      FixedDensityPDS.prototype.minDistance = null;
      FixedDensityPDS.prototype.maxDistance = null;
      FixedDensityPDS.prototype.minDistancePlusEpsilon = null;
      FixedDensityPDS.prototype.squaredMinDistance = null;
      FixedDensityPDS.prototype.deltaDistance = null;
      FixedDensityPDS.prototype.cellSize = null;
      FixedDensityPDS.prototype.maxTries = null;
      FixedDensityPDS.prototype.rng = null;
      FixedDensityPDS.prototype.neighbourhood = null;
      FixedDensityPDS.prototype.currentPoint = null;
      FixedDensityPDS.prototype.processList = null;
      FixedDensityPDS.prototype.samplePoints = null;
      FixedDensityPDS.prototype.gridShape = null;
      FixedDensityPDS.prototype.grid = null;
      FixedDensityPDS.prototype.addRandomPoint = function() {
        var point = new Array(this.dimension);
        for (var i = 0; i < this.dimension; i++) {
          point[i] = this.rng() * this.shape[i];
        }
        return this.directAddPoint(point);
      };
      FixedDensityPDS.prototype.addPoint = function(point) {
        var dimension, valid = true;
        if (point.length === this.dimension) {
          for (dimension = 0; dimension < this.dimension && valid; dimension++) {
            valid = point[dimension] >= 0 && point[dimension] < this.shape[dimension];
          }
        } else {
          valid = false;
        }
        return valid ? this.directAddPoint(point) : null;
      };
      FixedDensityPDS.prototype.directAddPoint = function(point) {
        var internalArrayIndex = 0, stride = this.grid.stride, dimension;
        this.processList.push(point);
        this.samplePoints.push(point);
        for (dimension = 0; dimension < this.dimension; dimension++) {
          internalArrayIndex += (point[dimension] / this.cellSize | 0) * stride[dimension];
        }
        this.grid.data[internalArrayIndex] = this.samplePoints.length;
        return point;
      };
      FixedDensityPDS.prototype.inNeighbourhood = function(point) {
        var dimensionNumber = this.dimension, stride = this.grid.stride, neighbourIndex, internalArrayIndex, dimension, currentDimensionValue, existingPoint;
        for (neighbourIndex = 0; neighbourIndex < this.neighbourhood.length; neighbourIndex++) {
          internalArrayIndex = 0;
          for (dimension = 0; dimension < dimensionNumber; dimension++) {
            currentDimensionValue = (point[dimension] / this.cellSize | 0) + this.neighbourhood[neighbourIndex][dimension];
            if (currentDimensionValue < 0 || currentDimensionValue >= this.gridShape[dimension]) {
              internalArrayIndex = -1;
              break;
            }
            internalArrayIndex += currentDimensionValue * stride[dimension];
          }
          if (internalArrayIndex !== -1 && this.grid.data[internalArrayIndex] !== 0) {
            existingPoint = this.samplePoints[this.grid.data[internalArrayIndex] - 1];
            if (squaredEuclideanDistance(point, existingPoint) < this.squaredMinDistance) {
              return true;
            }
          }
        }
        return false;
      };
      FixedDensityPDS.prototype.next = function() {
        var tries, angle, distance, currentPoint, newPoint, inShape, i;
        while (this.processList.length > 0) {
          if (this.currentPoint === null) {
            this.currentPoint = this.processList.shift();
          }
          currentPoint = this.currentPoint;
          for (tries = 0; tries < this.maxTries; tries++) {
            inShape = true;
            distance = this.minDistancePlusEpsilon + this.deltaDistance * this.rng();
            if (this.dimension === 2) {
              angle = this.rng() * Math.PI * 2;
              newPoint = [
                Math.cos(angle),
                Math.sin(angle)
              ];
            } else {
              newPoint = sphereRandom(this.dimension, this.rng);
            }
            for (i = 0; inShape && i < this.dimension; i++) {
              newPoint[i] = currentPoint[i] + newPoint[i] * distance;
              inShape = newPoint[i] >= 0 && newPoint[i] < this.shape[i];
            }
            if (inShape && !this.inNeighbourhood(newPoint)) {
              return this.directAddPoint(newPoint);
            }
          }
          if (tries === this.maxTries) {
            this.currentPoint = null;
          }
        }
        return null;
      };
      FixedDensityPDS.prototype.fill = function() {
        if (this.samplePoints.length === 0) {
          this.addRandomPoint();
        }
        while (this.next()) {
        }
        return this.samplePoints;
      };
      FixedDensityPDS.prototype.getAllPoints = function() {
        return this.samplePoints;
      };
      FixedDensityPDS.prototype.getAllPointsWithDistance = function() {
        throw new Error("PoissonDiskSampling: getAllPointsWithDistance() is not available in fixed-density implementation");
      };
      FixedDensityPDS.prototype.reset = function() {
        var gridData = this.grid.data, i = 0;
        for (i = 0; i < gridData.length; i++) {
          gridData[i] = 0;
        }
        this.samplePoints = [];
        this.currentPoint = null;
        this.processList.length = 0;
      };
      module.exports = FixedDensityPDS;
    }
  });

  // node_modules/poisson-disk-sampling/src/implementations/variable-density.js
  var require_variable_density = __commonJS({
    "node_modules/poisson-disk-sampling/src/implementations/variable-density.js"(exports, module) {
      "use strict";
      var tinyNDArray = require_tiny_ndarray().array;
      var sphereRandom = require_sphere_random();
      var getNeighbourhood = require_neighbourhood();
      function euclideanDistance(point1, point2) {
        var result = 0, i = 0;
        for (; i < point1.length; i++) {
          result += Math.pow(point1[i] - point2[i], 2);
        }
        return Math.sqrt(result);
      }
      function VariableDensityPDS(options, rng) {
        if (typeof options.distanceFunction !== "function") {
          throw new Error("PoissonDiskSampling: Tried to instantiate the variable density implementation without a distanceFunction");
        }
        this.shape = options.shape;
        this.minDistance = options.minDistance;
        this.maxDistance = options.maxDistance || options.minDistance * 2;
        this.maxTries = Math.ceil(Math.max(1, options.tries || 30));
        this.distanceFunction = options.distanceFunction;
        this.bias = Math.max(0, Math.min(1, options.bias || 0));
        this.rng = rng || Math.random;
        var maxShape = 0;
        for (var i = 0; i < this.shape.length; i++) {
          maxShape = Math.max(maxShape, this.shape[i]);
        }
        var floatPrecisionMitigation = Math.max(1, maxShape / 128 | 0);
        var epsilonDistance = 1e-14 * floatPrecisionMitigation;
        this.dimension = this.shape.length;
        this.minDistancePlusEpsilon = this.minDistance + epsilonDistance;
        this.deltaDistance = Math.max(0, this.maxDistance - this.minDistancePlusEpsilon);
        this.cellSize = this.maxDistance / Math.sqrt(this.dimension);
        this.neighbourhood = getNeighbourhood(this.dimension);
        this.currentPoint = null;
        this.currentDistance = 0;
        this.processList = [];
        this.samplePoints = [];
        this.sampleDistance = [];
        this.gridShape = [];
        for (var i = 0; i < this.dimension; i++) {
          this.gridShape.push(Math.ceil(this.shape[i] / this.cellSize));
        }
        this.grid = tinyNDArray(this.gridShape);
      }
      VariableDensityPDS.prototype.shape = null;
      VariableDensityPDS.prototype.dimension = null;
      VariableDensityPDS.prototype.minDistance = null;
      VariableDensityPDS.prototype.maxDistance = null;
      VariableDensityPDS.prototype.minDistancePlusEpsilon = null;
      VariableDensityPDS.prototype.deltaDistance = null;
      VariableDensityPDS.prototype.cellSize = null;
      VariableDensityPDS.prototype.maxTries = null;
      VariableDensityPDS.prototype.distanceFunction = null;
      VariableDensityPDS.prototype.bias = null;
      VariableDensityPDS.prototype.rng = null;
      VariableDensityPDS.prototype.neighbourhood = null;
      VariableDensityPDS.prototype.currentPoint = null;
      VariableDensityPDS.prototype.currentDistance = null;
      VariableDensityPDS.prototype.processList = null;
      VariableDensityPDS.prototype.samplePoints = null;
      VariableDensityPDS.prototype.sampleDistance = null;
      VariableDensityPDS.prototype.gridShape = null;
      VariableDensityPDS.prototype.grid = null;
      VariableDensityPDS.prototype.addRandomPoint = function() {
        var point = new Array(this.dimension);
        for (var i = 0; i < this.dimension; i++) {
          point[i] = this.rng() * this.shape[i];
        }
        return this.directAddPoint(point);
      };
      VariableDensityPDS.prototype.addPoint = function(point) {
        var dimension, valid = true;
        if (point.length === this.dimension) {
          for (dimension = 0; dimension < this.dimension && valid; dimension++) {
            valid = point[dimension] >= 0 && point[dimension] < this.shape[dimension];
          }
        } else {
          valid = false;
        }
        return valid ? this.directAddPoint(point) : null;
      };
      VariableDensityPDS.prototype.directAddPoint = function(point) {
        var internalArrayIndex = 0, stride = this.grid.stride, pointIndex = this.samplePoints.length, dimension;
        this.processList.push(pointIndex);
        this.samplePoints.push(point);
        this.sampleDistance.push(this.distanceFunction(point));
        for (dimension = 0; dimension < this.dimension; dimension++) {
          internalArrayIndex += (point[dimension] / this.cellSize | 0) * stride[dimension];
        }
        this.grid.data[internalArrayIndex].push(pointIndex);
        return point;
      };
      VariableDensityPDS.prototype.inNeighbourhood = function(point) {
        var dimensionNumber = this.dimension, stride = this.grid.stride, neighbourIndex, internalArrayIndex, dimension, currentDimensionValue, existingPoint, existingPointDistance;
        var pointDistance = this.distanceFunction(point);
        for (neighbourIndex = 0; neighbourIndex < this.neighbourhood.length; neighbourIndex++) {
          internalArrayIndex = 0;
          for (dimension = 0; dimension < dimensionNumber; dimension++) {
            currentDimensionValue = (point[dimension] / this.cellSize | 0) + this.neighbourhood[neighbourIndex][dimension];
            if (currentDimensionValue < 0 || currentDimensionValue >= this.gridShape[dimension]) {
              internalArrayIndex = -1;
              break;
            }
            internalArrayIndex += currentDimensionValue * stride[dimension];
          }
          if (internalArrayIndex !== -1 && this.grid.data[internalArrayIndex].length > 0) {
            for (var i = 0; i < this.grid.data[internalArrayIndex].length; i++) {
              existingPoint = this.samplePoints[this.grid.data[internalArrayIndex][i]];
              existingPointDistance = this.sampleDistance[this.grid.data[internalArrayIndex][i]];
              var minDistance = Math.min(existingPointDistance, pointDistance);
              var maxDistance = Math.max(existingPointDistance, pointDistance);
              var dist2 = minDistance + (maxDistance - minDistance) * this.bias;
              if (euclideanDistance(point, existingPoint) < this.minDistance + this.deltaDistance * dist2) {
                return true;
              }
            }
          }
        }
        return false;
      };
      VariableDensityPDS.prototype.next = function() {
        var tries, angle, distance, currentPoint, currentDistance, newPoint, inShape, i;
        while (this.processList.length > 0) {
          if (this.currentPoint === null) {
            var sampleIndex = this.processList.shift();
            this.currentPoint = this.samplePoints[sampleIndex];
            this.currentDistance = this.sampleDistance[sampleIndex];
          }
          currentPoint = this.currentPoint;
          currentDistance = this.currentDistance;
          for (tries = 0; tries < this.maxTries; tries++) {
            inShape = true;
            distance = this.minDistancePlusEpsilon + this.deltaDistance * (currentDistance + (1 - currentDistance) * this.bias);
            if (this.dimension === 2) {
              angle = this.rng() * Math.PI * 2;
              newPoint = [
                Math.cos(angle),
                Math.sin(angle)
              ];
            } else {
              newPoint = sphereRandom(this.dimension, this.rng);
            }
            for (i = 0; inShape && i < this.dimension; i++) {
              newPoint[i] = currentPoint[i] + newPoint[i] * distance;
              inShape = newPoint[i] >= 0 && newPoint[i] < this.shape[i];
            }
            if (inShape && !this.inNeighbourhood(newPoint)) {
              return this.directAddPoint(newPoint);
            }
          }
          if (tries === this.maxTries) {
            this.currentPoint = null;
          }
        }
        return null;
      };
      VariableDensityPDS.prototype.fill = function() {
        if (this.samplePoints.length === 0) {
          this.addRandomPoint();
        }
        while (this.next()) {
        }
        return this.samplePoints;
      };
      VariableDensityPDS.prototype.getAllPoints = function() {
        return this.samplePoints;
      };
      VariableDensityPDS.prototype.getAllPointsWithDistance = function() {
        var result = new Array(this.samplePoints.length), i = 0, dimension = 0, point;
        for (i = 0; i < this.samplePoints.length; i++) {
          point = new Array(this.dimension + 1);
          for (dimension = 0; dimension < this.dimension; dimension++) {
            point[dimension] = this.samplePoints[i][dimension];
          }
          point[this.dimension] = this.sampleDistance[i];
          result[i] = point;
        }
        return result;
      };
      VariableDensityPDS.prototype.reset = function() {
        var gridData = this.grid.data, i = 0;
        for (i = 0; i < gridData.length; i++) {
          gridData[i] = [];
        }
        this.samplePoints = [];
        this.currentPoint = null;
        this.processList.length = 0;
      };
      module.exports = VariableDensityPDS;
    }
  });

  // node_modules/poisson-disk-sampling/src/poisson-disk-sampling.js
  var require_poisson_disk_sampling = __commonJS({
    "node_modules/poisson-disk-sampling/src/poisson-disk-sampling.js"(exports, module) {
      "use strict";
      var FixedDensityPDS = require_fixed_density();
      var VariableDensityPDS = require_variable_density();
      function PoissonDiskSampling(options, rng) {
        this.shape = options.shape;
        if (typeof options.distanceFunction === "function") {
          this.implementation = new VariableDensityPDS(options, rng);
        } else {
          this.implementation = new FixedDensityPDS(options, rng);
        }
      }
      PoissonDiskSampling.prototype.implementation = null;
      PoissonDiskSampling.prototype.addRandomPoint = function() {
        return this.implementation.addRandomPoint();
      };
      PoissonDiskSampling.prototype.addPoint = function(point) {
        return this.implementation.addPoint(point);
      };
      PoissonDiskSampling.prototype.next = function() {
        return this.implementation.next();
      };
      PoissonDiskSampling.prototype.fill = function() {
        return this.implementation.fill();
      };
      PoissonDiskSampling.prototype.getAllPoints = function() {
        return this.implementation.getAllPoints();
      };
      PoissonDiskSampling.prototype.getAllPointsWithDistance = function() {
        return this.implementation.getAllPointsWithDistance();
      };
      PoissonDiskSampling.prototype.reset = function() {
        this.implementation.reset();
      };
      module.exports = PoissonDiskSampling;
    }
  });

  // node_modules/hash-int/hashint.js
  var require_hashint = __commonJS({
    "node_modules/hash-int/hashint.js"(exports, module) {
      "use strict";
      var A;
      if (typeof Uint32Array === void 0) {
        A = [0];
      } else {
        A = new Uint32Array(1);
      }
      function hashInt(x) {
        A[0] = x | 0;
        A[0] -= A[0] << 6;
        A[0] ^= A[0] >>> 17;
        A[0] -= A[0] << 9;
        A[0] ^= A[0] << 4;
        A[0] -= A[0] << 3;
        A[0] ^= A[0] << 10;
        A[0] ^= A[0] >>> 15;
        return A[0];
      }
      module.exports = hashInt;
    }
  });

  // node_modules/@redblobgames/prng/index.js
  var require_prng = __commonJS({
    "node_modules/@redblobgames/prng/index.js"(exports) {
      "use strict";
      var hashInt = require_hashint();
      exports.makeRandInt = function(seed) {
        let i = 0;
        return function(N) {
          i++;
          return hashInt(seed + i) % N;
        };
      };
      exports.makeRandFloat = function(seed) {
        let randInt = exports.makeRandInt(seed);
        let divisor2 = 268435456;
        return function() {
          return randInt(divisor2) / divisor2;
        };
      };
    }
  });

  // entry.js
  var entry_exports = {};
  __export(entry_exports, {
    generateMap: () => generateMap
  });

  // util.js
  function fbm_noise(noise, amplitudes, nx, ny) {
    let sum2 = 0, sumOfAmplitudes = 0;
    for (let octave = 0; octave < amplitudes.length; octave++) {
      let frequency = 1 << octave;
      sum2 += amplitudes[octave] * noise.noise2D(nx * frequency, ny * frequency, octave);
      sumOfAmplitudes += amplitudes[octave];
    }
    return sum2 / sumOfAmplitudes;
  }
  function lerp(a, b, t) {
    return a * (1 - t) + b * t;
  }
  function lerpv(p, q, t, out = []) {
    out.length = p.length;
    for (let i = 0; i < p.length; i++) {
      out[i] = lerp(p[i], q[i], t);
    }
    return out;
  }
  function randomShuffle(array, randInt) {
    for (let i = array.length - 1; i > 0; i--) {
      let j = randInt(i + 1);
      let swap2 = array[i];
      array[i] = array[j];
      array[j] = swap2;
    }
    return array;
  }

  // water.js
  function assign_water_r(water_r, mesh, noise, params) {
    water_r.length = mesh.numRegions;
    for (let r = 0; r < mesh.numRegions; r++) {
      if (mesh.is_ghost_r(r) || mesh.is_boundary_r(r)) {
        water_r[r] = true;
      } else {
        let nx = (mesh.x_of_r(r) - 500) / 500;
        let ny = (mesh.y_of_r(r) - 500) / 500;
        let distance = Math.max(Math.abs(nx), Math.abs(ny));
        let n = fbm_noise(noise, params.amplitudes, nx, ny);
        n = lerp(n, 0.5, params.round);
        water_r[r] = n - (1 - params.inflate) * distance * distance < 0;
      }
    }
    return water_r;
  }
  function assign_ocean_r(ocean_r, mesh, water_r) {
    ocean_r.length = mesh.numRegions;
    ocean_r.fill(false);
    let stack = [mesh.r_ghost()];
    let r_out = [];
    while (stack.length > 0) {
      let r1 = stack.pop();
      mesh.r_around_r(r1, r_out);
      for (let r2 of r_out) {
        if (water_r[r2] && !ocean_r[r2]) {
          ocean_r[r2] = true;
          stack.push(r2);
        }
      }
    }
    return ocean_r;
  }

  // elevation.js
  function find_t_coasts(mesh, ocean_r) {
    let t_coasts = [];
    for (let s = 0; s < mesh.numSides; s++) {
      let r0 = mesh.r_begin_s(s);
      let r1 = mesh.r_end_s(s);
      let t = mesh.t_inner_s(s);
      if (ocean_r[r0] && !ocean_r[r1]) {
        t_coasts.push(t);
      }
    }
    return t_coasts;
  }
  function assign_elevation_t(elevation_t, coastdistance_t, s_downslope_t, mesh, ocean_r, water_r, randInt) {
    coastdistance_t.length = mesh.numTriangles;
    s_downslope_t.length = mesh.numTriangles;
    elevation_t.length = mesh.numTriangles;
    coastdistance_t.fill(null);
    s_downslope_t.fill(-1);
    const is_ocean_t = (t) => ocean_r[mesh.r_begin_s(3 * t)];
    const is_lake_r = (r) => water_r[r] && !ocean_r[r];
    const is_lake_s = (s) => is_lake_r(mesh.r_begin_s(s)) || is_lake_r(mesh.r_end_s(s));
    let s_out = [];
    let t_queue = find_t_coasts(mesh, ocean_r);
    t_queue.forEach((t) => {
      coastdistance_t[t] = 0;
    });
    let minDistance = 1, maxDistance = 1;
    while (t_queue.length > 0) {
      let t_current = t_queue.shift();
      mesh.s_around_t(t_current, s_out);
      let iOffset = randInt(s_out.length);
      for (let i = 0; i < s_out.length; i++) {
        let s = s_out[(i + iOffset) % s_out.length];
        let lake = is_lake_s(s);
        let neighbor_t = mesh.t_outer_s(s);
        let newDistance = (lake ? 0 : 1) + coastdistance_t[t_current];
        if (coastdistance_t[neighbor_t] === null || newDistance < coastdistance_t[neighbor_t]) {
          s_downslope_t[neighbor_t] = mesh.s_opposite_s(s);
          coastdistance_t[neighbor_t] = newDistance;
          if (is_ocean_t(neighbor_t) && newDistance > minDistance) {
            minDistance = newDistance;
          }
          if (!is_ocean_t(neighbor_t) && newDistance > maxDistance) {
            maxDistance = newDistance;
          }
          if (lake) {
            t_queue.unshift(neighbor_t);
          } else {
            t_queue.push(neighbor_t);
          }
        }
      }
    }
    coastdistance_t.forEach((d, t) => {
      elevation_t[t] = is_ocean_t(t) ? -d / minDistance : d / maxDistance;
    });
  }
  function assign_elevation_r(elevation_r, mesh, elevation_t, ocean_r) {
    const max_ocean_elevation = -0.01;
    elevation_r.length = mesh.numRegions;
    let t_out = [];
    for (let r = 0; r < mesh.numRegions; r++) {
      mesh.t_around_r(r, t_out);
      let elevation = 0;
      for (let t of t_out) {
        elevation += elevation_t[t];
      }
      elevation_r[r] = elevation / t_out.length;
      if (ocean_r[r] && elevation_r[r] > max_ocean_elevation) {
        elevation_r[r] = max_ocean_elevation;
      }
    }
    return elevation_r;
  }
  function redistribute_elevation_t(elevation_t, mesh) {
    const SCALE_FACTOR = 1.1;
    let t_nonocean = [];
    for (let t = 0; t < mesh.numSolidTriangles; t++) {
      if (elevation_t[t] > 0) {
        t_nonocean.push(t);
      }
    }
    t_nonocean.sort((t1, t2) => elevation_t[t1] - elevation_t[t2]);
    for (let i = 0; i < t_nonocean.length; i++) {
      let y = i / (t_nonocean.length - 1);
      let x = Math.sqrt(SCALE_FACTOR) - Math.sqrt(SCALE_FACTOR * (1 - y));
      if (x > 1) x = 1;
      elevation_t[t_nonocean[i]] = x;
    }
  }

  // rivers.js
  var MIN_SPRING_ELEVATION = 0.3;
  var MAX_SPRING_ELEVATION = 0.9;
  function find_t_spring(mesh, water_r, elevation_t) {
    const is_water_t = (t) => water_r[mesh.r_begin_s(3 * t)] || water_r[mesh.r_begin_s(3 * t + 1)] || water_r[mesh.r_begin_s(3 * t + 2)];
    let t_spring = /* @__PURE__ */ new Set();
    for (let t = 0; t < mesh.numSolidTriangles; t++) {
      if (elevation_t[t] >= MIN_SPRING_ELEVATION && elevation_t[t] <= MAX_SPRING_ELEVATION && !is_water_t(t)) {
        t_spring.add(t);
      }
    }
    return Array.from(t_spring);
  }
  function assign_flow_s(flow_s, mesh, s_downslope_t, t_river) {
    flow_s.length = mesh.numSides;
    flow_s.fill(0);
    for (let t of t_river) {
      for (; ; ) {
        let s = s_downslope_t[t];
        if (s === -1) {
          break;
        }
        flow_s[s]++;
        let next_t = mesh.t_outer_s(s);
        if (next_t === t) {
          break;
        }
        t = next_t;
      }
    }
    return flow_s;
  }

  // moisture.js
  function find_riverbanks_r(r_out, mesh, flow_s) {
    for (let s = 0; s < mesh.numSolidSides; s++) {
      if (flow_s[s] > 0) {
        r_out.add(mesh.r_begin_s(s));
        r_out.add(mesh.r_end_s(s));
      }
    }
  }
  function find_lakeshores_r(r_out, mesh, ocean_r, water_r) {
    for (let s = 0; s < mesh.numSolidSides; s++) {
      let r0 = mesh.r_begin_s(s), r1 = mesh.r_end_s(s);
      if (water_r[r0] && !ocean_r[r0]) {
        r_out.add(r0);
        r_out.add(r1);
      }
    }
  }
  function find_moisture_r_seeds(mesh, flow_s, ocean_r, water_r) {
    let r_seeds = /* @__PURE__ */ new Set();
    find_riverbanks_r(r_seeds, mesh, flow_s);
    find_lakeshores_r(r_seeds, mesh, ocean_r, water_r);
    return r_seeds;
  }
  function assign_moisture_r(moisture_r, waterdistance_r, mesh, water_r, r_seeds) {
    waterdistance_r.length = mesh.numRegions;
    moisture_r.length = mesh.numRegions;
    waterdistance_r.fill(null);
    let r_out = [];
    let r_queue = Array.from(r_seeds);
    let maxDistance = 1;
    r_queue.forEach((r) => {
      waterdistance_r[r] = 0;
    });
    while (r_queue.length > 0) {
      let r_current = r_queue.shift();
      mesh.r_around_r(r_current, r_out);
      for (let r_neighbor of r_out) {
        if (!water_r[r_neighbor] && waterdistance_r[r_neighbor] === null) {
          let newDistance = 1 + waterdistance_r[r_current];
          waterdistance_r[r_neighbor] = newDistance;
          if (newDistance > maxDistance) {
            maxDistance = newDistance;
          }
          r_queue.push(r_neighbor);
        }
      }
    }
    waterdistance_r.forEach((d, r) => {
      moisture_r[r] = water_r[r] ? 1 : 1 - Math.pow(d / maxDistance, 0.5);
    });
  }
  function redistribute_moisture_r(moisture_r, mesh, water_r, min_moisture, max_moisture) {
    let r_land = [];
    for (let r = 0; r < mesh.numSolidRegions; r++) {
      if (!water_r[r]) {
        r_land.push(r);
      }
    }
    r_land.sort((r1, r2) => moisture_r[r1] - moisture_r[r2]);
    for (let i = 0; i < r_land.length; i++) {
      moisture_r[r_land[i]] = min_moisture + (max_moisture - min_moisture) * i / (r_land.length - 1);
    }
  }

  // biomes.js
  function biome(ocean, water, coast, temperature, moisture) {
    if (ocean) {
      return "OCEAN";
    } else if (water) {
      if (temperature > 0.9) return "MARSH";
      if (temperature < 0.2) return "ICE";
      return "LAKE";
    } else if (coast) {
      return "BEACH";
    } else if (temperature < 0.2) {
      if (moisture > 0.5) return "SNOW";
      else if (moisture > 0.33) return "TUNDRA";
      else if (moisture > 0.16) return "BARE";
      else return "SCORCHED";
    } else if (temperature < 0.4) {
      if (moisture > 0.66) return "TAIGA";
      else if (moisture > 0.33) return "SHRUBLAND";
      else return "TEMPERATE_DESERT";
    } else if (temperature < 0.7) {
      if (moisture > 0.83) return "TEMPERATE_RAIN_FOREST";
      else if (moisture > 0.5) return "TEMPERATE_DECIDUOUS_FOREST";
      else if (moisture > 0.16) return "GRASSLAND";
      else return "TEMPERATE_DESERT";
    } else {
      if (moisture > 0.66) return "TROPICAL_RAIN_FOREST";
      else if (moisture > 0.33) return "TROPICAL_SEASONAL_FOREST";
      else if (moisture > 0.16) return "GRASSLAND";
      else return "SUBTROPICAL_DESERT";
    }
  }
  function assign_coast_r(coast_r, mesh, ocean_r) {
    coast_r.length = mesh.numRegions;
    coast_r.fill(false);
    let r_out = [];
    for (let r1 = 0; r1 < mesh.numRegions; r1++) {
      mesh.r_around_r(r1, r_out);
      if (!ocean_r[r1]) {
        for (let r2 of r_out) {
          if (ocean_r[r2]) {
            coast_r[r1] = true;
            break;
          }
        }
      }
    }
    return coast_r;
  }
  function assign_temperature_r(temperature_r, mesh, elevation_r, bias_north, bias_south) {
    temperature_r.length = mesh.numRegions;
    for (let r = 0; r < mesh.numRegions; r++) {
      let latitude = mesh.y_of_r(r) / 1e3;
      let delta_temperature = lerp(bias_north, bias_south, latitude);
      temperature_r[r] = 1 - elevation_r[r] + delta_temperature;
    }
    return temperature_r;
  }
  function assign_biome_r(biome_r, mesh, ocean_r, water_r, coast_r, temperature_r, moisture_r) {
    biome_r.length = mesh.numRegions;
    for (let r = 0; r < mesh.numRegions; r++) {
      biome_r[r] = biome(
        ocean_r[r],
        water_r[r],
        coast_r[r],
        temperature_r[r],
        moisture_r[r]
      );
    }
    return biome_r;
  }

  // noisy-edges.js
  var divisor = 268435456;
  function recursiveSubdivision(length, amplitude, randInt) {
    function recur(a, b, p, q) {
      let dx = a[0] - b[0], dy = a[1] - b[1];
      if (dx * dx + dy * dy < length * length) {
        return [b];
      }
      let ap = lerpv(a, p, 0.5), bp = lerpv(b, p, 0.5), aq = lerpv(a, q, 0.5), bq = lerpv(b, q, 0.5);
      let division = 0.5 * (1 - amplitude) + randInt(divisor) / divisor * amplitude;
      let center = lerpv(p, q, division);
      let results1 = recur(a, center, ap, aq), results2 = recur(center, b, bp, bq);
      return results1.concat(results2);
    }
    ;
    return recur;
  }
  function assign_lines_s(lines_s, mesh, { amplitude, length }, randInt) {
    const subdivide = recursiveSubdivision(length, amplitude, randInt);
    lines_s.length = mesh.numSides;
    for (let s = 0; s < mesh.numSides; s++) {
      let t0 = mesh.t_inner_s(s), t1 = mesh.t_outer_s(s), r0 = mesh.r_begin_s(s), r1 = mesh.r_end_s(s);
      if (r0 < r1) {
        if (mesh.is_ghost_s(s)) {
          lines_s[s] = [mesh.pos_of_t(t1)];
        } else {
          lines_s[s] = subdivide(
            mesh.pos_of_t(t0),
            mesh.pos_of_t(t1),
            mesh.pos_of_r(r0),
            mesh.pos_of_r(r1)
          );
        }
        let opposite = lines_s[s].slice(0, -1);
        opposite.reverse();
        opposite.push(mesh.pos_of_t(t0));
        lines_s[mesh.s_opposite_s(s)] = opposite;
      }
    }
    return lines_s;
  }

  // map.js
  var WorldMap = class {
    constructor(mesh, noisyEdgeOptions, makeRandInt2) {
      this.mesh = mesh;
      this.makeRandInt = makeRandInt2;
      this.lines_s = assign_lines_s(
        [],
        this.mesh,
        noisyEdgeOptions,
        this.makeRandInt(noisyEdgeOptions.seed)
      );
      this.water_r = [];
      this.ocean_r = [];
      this.coastdistance_t = [];
      this.elevation_t = [];
      this.s_downslope_t = [];
      this.elevation_r = [];
      this.flow_s = [];
      this.waterdistance_r = [];
      this.moisture_r = [];
      this.coast_r = [];
      this.temperature_r = [];
      this.biome_r = [];
    }
    calculate(options) {
      options = Object.assign({
        noise: null,
        // required: function(nx, ny) -> number from -1 to +1
        shape: { round: 0.5, inflate: 0.4, amplitudes: [1 / 2, 1 / 4, 1 / 8, 1 / 16] },
        numRivers: 30,
        drainageSeed: 0,
        riverSeed: 0,
        noisyEdge: { length: 10, amplitude: 0.2, seed: 0 },
        biomeBias: { north_temperature: 0, south_temperature: 0, moisture: 0 }
      }, options);
      assign_water_r(this.water_r, this.mesh, options.noise, options.shape);
      assign_ocean_r(this.ocean_r, this.mesh, this.water_r);
      assign_elevation_t(
        this.elevation_t,
        this.coastdistance_t,
        this.s_downslope_t,
        this.mesh,
        this.ocean_r,
        this.water_r,
        this.makeRandInt(options.drainageSeed)
      );
      redistribute_elevation_t(this.elevation_t, this.mesh);
      assign_elevation_r(this.elevation_r, this.mesh, this.elevation_t, this.ocean_r);
      this.t_spring = find_t_spring(this.mesh, this.water_r, this.elevation_t);
      randomShuffle(this.t_spring, this.makeRandInt(options.riverSeed));
      this.t_river = this.t_spring.slice(0, options.numRivers);
      assign_flow_s(this.flow_s, this.mesh, this.s_downslope_t, this.t_river);
      assign_moisture_r(
        this.moisture_r,
        this.waterdistance_r,
        this.mesh,
        this.water_r,
        find_moisture_r_seeds(this.mesh, this.flow_s, this.ocean_r, this.water_r)
      );
      redistribute_moisture_r(
        this.moisture_r,
        this.mesh,
        this.water_r,
        options.biomeBias.moisture,
        1 + options.biomeBias.moisture
      );
      assign_coast_r(this.coast_r, this.mesh, this.ocean_r);
      assign_temperature_r(
        this.temperature_r,
        this.mesh,
        this.elevation_r,
        options.biomeBias.north_temperature,
        options.biomeBias.south_temperature
      );
      assign_biome_r(
        this.biome_r,
        this.mesh,
        this.ocean_r,
        this.water_r,
        this.coast_r,
        this.temperature_r,
        this.moisture_r
      );
    }
  };

  // entry.js
  var import_simplex_noise = __toESM(require_simplex_noise());

  // node_modules/robust-predicates/esm/util.js
  var epsilon = 11102230246251565e-32;
  var splitter = 134217729;
  var resulterrbound = (3 + 8 * epsilon) * epsilon;
  function sum(elen, e, flen, f, h) {
    let Q, Qnew, hh, bvirt;
    let enow = e[0];
    let fnow = f[0];
    let eindex = 0;
    let findex = 0;
    if (fnow > enow === fnow > -enow) {
      Q = enow;
      enow = e[++eindex];
    } else {
      Q = fnow;
      fnow = f[++findex];
    }
    let hindex = 0;
    if (eindex < elen && findex < flen) {
      if (fnow > enow === fnow > -enow) {
        Qnew = enow + Q;
        hh = Q - (Qnew - enow);
        enow = e[++eindex];
      } else {
        Qnew = fnow + Q;
        hh = Q - (Qnew - fnow);
        fnow = f[++findex];
      }
      Q = Qnew;
      if (hh !== 0) {
        h[hindex++] = hh;
      }
      while (eindex < elen && findex < flen) {
        if (fnow > enow === fnow > -enow) {
          Qnew = Q + enow;
          bvirt = Qnew - Q;
          hh = Q - (Qnew - bvirt) + (enow - bvirt);
          enow = e[++eindex];
        } else {
          Qnew = Q + fnow;
          bvirt = Qnew - Q;
          hh = Q - (Qnew - bvirt) + (fnow - bvirt);
          fnow = f[++findex];
        }
        Q = Qnew;
        if (hh !== 0) {
          h[hindex++] = hh;
        }
      }
    }
    while (eindex < elen) {
      Qnew = Q + enow;
      bvirt = Qnew - Q;
      hh = Q - (Qnew - bvirt) + (enow - bvirt);
      enow = e[++eindex];
      Q = Qnew;
      if (hh !== 0) {
        h[hindex++] = hh;
      }
    }
    while (findex < flen) {
      Qnew = Q + fnow;
      bvirt = Qnew - Q;
      hh = Q - (Qnew - bvirt) + (fnow - bvirt);
      fnow = f[++findex];
      Q = Qnew;
      if (hh !== 0) {
        h[hindex++] = hh;
      }
    }
    if (Q !== 0 || hindex === 0) {
      h[hindex++] = Q;
    }
    return hindex;
  }
  function estimate(elen, e) {
    let Q = e[0];
    for (let i = 1; i < elen; i++) Q += e[i];
    return Q;
  }
  function vec(n) {
    return new Float64Array(n);
  }

  // node_modules/robust-predicates/esm/orient2d.js
  var ccwerrboundA = (3 + 16 * epsilon) * epsilon;
  var ccwerrboundB = (2 + 12 * epsilon) * epsilon;
  var ccwerrboundC = (9 + 64 * epsilon) * epsilon * epsilon;
  var B = vec(4);
  var C1 = vec(8);
  var C2 = vec(12);
  var D = vec(16);
  var u = vec(4);
  function orient2dadapt(ax, ay, bx, by, cx, cy, detsum) {
    let acxtail, acytail, bcxtail, bcytail;
    let bvirt, c, ahi, alo, bhi, blo, _i, _j, _0, s1, s0, t1, t0, u32;
    const acx = ax - cx;
    const bcx = bx - cx;
    const acy = ay - cy;
    const bcy = by - cy;
    s1 = acx * bcy;
    c = splitter * acx;
    ahi = c - (c - acx);
    alo = acx - ahi;
    c = splitter * bcy;
    bhi = c - (c - bcy);
    blo = bcy - bhi;
    s0 = alo * blo - (s1 - ahi * bhi - alo * bhi - ahi * blo);
    t1 = acy * bcx;
    c = splitter * acy;
    ahi = c - (c - acy);
    alo = acy - ahi;
    c = splitter * bcx;
    bhi = c - (c - bcx);
    blo = bcx - bhi;
    t0 = alo * blo - (t1 - ahi * bhi - alo * bhi - ahi * blo);
    _i = s0 - t0;
    bvirt = s0 - _i;
    B[0] = s0 - (_i + bvirt) + (bvirt - t0);
    _j = s1 + _i;
    bvirt = _j - s1;
    _0 = s1 - (_j - bvirt) + (_i - bvirt);
    _i = _0 - t1;
    bvirt = _0 - _i;
    B[1] = _0 - (_i + bvirt) + (bvirt - t1);
    u32 = _j + _i;
    bvirt = u32 - _j;
    B[2] = _j - (u32 - bvirt) + (_i - bvirt);
    B[3] = u32;
    let det = estimate(4, B);
    let errbound = ccwerrboundB * detsum;
    if (det >= errbound || -det >= errbound) {
      return det;
    }
    bvirt = ax - acx;
    acxtail = ax - (acx + bvirt) + (bvirt - cx);
    bvirt = bx - bcx;
    bcxtail = bx - (bcx + bvirt) + (bvirt - cx);
    bvirt = ay - acy;
    acytail = ay - (acy + bvirt) + (bvirt - cy);
    bvirt = by - bcy;
    bcytail = by - (bcy + bvirt) + (bvirt - cy);
    if (acxtail === 0 && acytail === 0 && bcxtail === 0 && bcytail === 0) {
      return det;
    }
    errbound = ccwerrboundC * detsum + resulterrbound * Math.abs(det);
    det += acx * bcytail + bcy * acxtail - (acy * bcxtail + bcx * acytail);
    if (det >= errbound || -det >= errbound) return det;
    s1 = acxtail * bcy;
    c = splitter * acxtail;
    ahi = c - (c - acxtail);
    alo = acxtail - ahi;
    c = splitter * bcy;
    bhi = c - (c - bcy);
    blo = bcy - bhi;
    s0 = alo * blo - (s1 - ahi * bhi - alo * bhi - ahi * blo);
    t1 = acytail * bcx;
    c = splitter * acytail;
    ahi = c - (c - acytail);
    alo = acytail - ahi;
    c = splitter * bcx;
    bhi = c - (c - bcx);
    blo = bcx - bhi;
    t0 = alo * blo - (t1 - ahi * bhi - alo * bhi - ahi * blo);
    _i = s0 - t0;
    bvirt = s0 - _i;
    u[0] = s0 - (_i + bvirt) + (bvirt - t0);
    _j = s1 + _i;
    bvirt = _j - s1;
    _0 = s1 - (_j - bvirt) + (_i - bvirt);
    _i = _0 - t1;
    bvirt = _0 - _i;
    u[1] = _0 - (_i + bvirt) + (bvirt - t1);
    u32 = _j + _i;
    bvirt = u32 - _j;
    u[2] = _j - (u32 - bvirt) + (_i - bvirt);
    u[3] = u32;
    const C1len = sum(4, B, 4, u, C1);
    s1 = acx * bcytail;
    c = splitter * acx;
    ahi = c - (c - acx);
    alo = acx - ahi;
    c = splitter * bcytail;
    bhi = c - (c - bcytail);
    blo = bcytail - bhi;
    s0 = alo * blo - (s1 - ahi * bhi - alo * bhi - ahi * blo);
    t1 = acy * bcxtail;
    c = splitter * acy;
    ahi = c - (c - acy);
    alo = acy - ahi;
    c = splitter * bcxtail;
    bhi = c - (c - bcxtail);
    blo = bcxtail - bhi;
    t0 = alo * blo - (t1 - ahi * bhi - alo * bhi - ahi * blo);
    _i = s0 - t0;
    bvirt = s0 - _i;
    u[0] = s0 - (_i + bvirt) + (bvirt - t0);
    _j = s1 + _i;
    bvirt = _j - s1;
    _0 = s1 - (_j - bvirt) + (_i - bvirt);
    _i = _0 - t1;
    bvirt = _0 - _i;
    u[1] = _0 - (_i + bvirt) + (bvirt - t1);
    u32 = _j + _i;
    bvirt = u32 - _j;
    u[2] = _j - (u32 - bvirt) + (_i - bvirt);
    u[3] = u32;
    const C2len = sum(C1len, C1, 4, u, C2);
    s1 = acxtail * bcytail;
    c = splitter * acxtail;
    ahi = c - (c - acxtail);
    alo = acxtail - ahi;
    c = splitter * bcytail;
    bhi = c - (c - bcytail);
    blo = bcytail - bhi;
    s0 = alo * blo - (s1 - ahi * bhi - alo * bhi - ahi * blo);
    t1 = acytail * bcxtail;
    c = splitter * acytail;
    ahi = c - (c - acytail);
    alo = acytail - ahi;
    c = splitter * bcxtail;
    bhi = c - (c - bcxtail);
    blo = bcxtail - bhi;
    t0 = alo * blo - (t1 - ahi * bhi - alo * bhi - ahi * blo);
    _i = s0 - t0;
    bvirt = s0 - _i;
    u[0] = s0 - (_i + bvirt) + (bvirt - t0);
    _j = s1 + _i;
    bvirt = _j - s1;
    _0 = s1 - (_j - bvirt) + (_i - bvirt);
    _i = _0 - t1;
    bvirt = _0 - _i;
    u[1] = _0 - (_i + bvirt) + (bvirt - t1);
    u32 = _j + _i;
    bvirt = u32 - _j;
    u[2] = _j - (u32 - bvirt) + (_i - bvirt);
    u[3] = u32;
    const Dlen = sum(C2len, C2, 4, u, D);
    return D[Dlen - 1];
  }
  function orient2d(ax, ay, bx, by, cx, cy) {
    const detleft = (ay - cy) * (bx - cx);
    const detright = (ax - cx) * (by - cy);
    const det = detleft - detright;
    const detsum = Math.abs(detleft + detright);
    if (Math.abs(det) >= ccwerrboundA * detsum) return det;
    return -orient2dadapt(ax, ay, bx, by, cx, cy, detsum);
  }

  // node_modules/robust-predicates/esm/orient3d.js
  var o3derrboundA = (7 + 56 * epsilon) * epsilon;
  var o3derrboundB = (3 + 28 * epsilon) * epsilon;
  var o3derrboundC = (26 + 288 * epsilon) * epsilon * epsilon;
  var bc = vec(4);
  var ca = vec(4);
  var ab = vec(4);
  var at_b = vec(4);
  var at_c = vec(4);
  var bt_c = vec(4);
  var bt_a = vec(4);
  var ct_a = vec(4);
  var ct_b = vec(4);
  var bct = vec(8);
  var cat = vec(8);
  var abt = vec(8);
  var u2 = vec(4);
  var _8 = vec(8);
  var _8b = vec(8);
  var _16 = vec(16);
  var _12 = vec(12);
  var fin = vec(192);
  var fin2 = vec(192);

  // node_modules/robust-predicates/esm/incircle.js
  var iccerrboundA = (10 + 96 * epsilon) * epsilon;
  var iccerrboundB = (4 + 48 * epsilon) * epsilon;
  var iccerrboundC = (44 + 576 * epsilon) * epsilon * epsilon;
  var bc2 = vec(4);
  var ca2 = vec(4);
  var ab2 = vec(4);
  var aa = vec(4);
  var bb = vec(4);
  var cc = vec(4);
  var u3 = vec(4);
  var v = vec(4);
  var axtbc = vec(8);
  var aytbc = vec(8);
  var bxtca = vec(8);
  var bytca = vec(8);
  var cxtab = vec(8);
  var cytab = vec(8);
  var abt2 = vec(8);
  var bct2 = vec(8);
  var cat2 = vec(8);
  var abtt = vec(4);
  var bctt = vec(4);
  var catt = vec(4);
  var _82 = vec(8);
  var _162 = vec(16);
  var _16b = vec(16);
  var _16c = vec(16);
  var _32 = vec(32);
  var _32b = vec(32);
  var _48 = vec(48);
  var _64 = vec(64);
  var fin3 = vec(1152);
  var fin22 = vec(1152);

  // node_modules/robust-predicates/esm/insphere.js
  var isperrboundA = (16 + 224 * epsilon) * epsilon;
  var isperrboundB = (5 + 72 * epsilon) * epsilon;
  var isperrboundC = (71 + 1408 * epsilon) * epsilon * epsilon;
  var ab3 = vec(4);
  var bc3 = vec(4);
  var cd = vec(4);
  var de = vec(4);
  var ea = vec(4);
  var ac = vec(4);
  var bd = vec(4);
  var ce = vec(4);
  var da = vec(4);
  var eb = vec(4);
  var abc = vec(24);
  var bcd = vec(24);
  var cde = vec(24);
  var dea = vec(24);
  var eab = vec(24);
  var abd = vec(24);
  var bce = vec(24);
  var cda = vec(24);
  var deb = vec(24);
  var eac = vec(24);
  var adet = vec(1152);
  var bdet = vec(1152);
  var cdet = vec(1152);
  var ddet = vec(1152);
  var edet = vec(1152);
  var abdet = vec(2304);
  var cddet = vec(2304);
  var cdedet = vec(3456);
  var deter = vec(5760);
  var _83 = vec(8);
  var _8b2 = vec(8);
  var _8c = vec(8);
  var _163 = vec(16);
  var _24 = vec(24);
  var _482 = vec(48);
  var _48b = vec(48);
  var _96 = vec(96);
  var _192 = vec(192);
  var _384x = vec(384);
  var _384y = vec(384);
  var _384z = vec(384);
  var _768 = vec(768);
  var xdet = vec(96);
  var ydet = vec(96);
  var zdet = vec(96);
  var fin4 = vec(1152);

  // node_modules/delaunator/index.js
  var EPSILON = Math.pow(2, -52);
  var EDGE_STACK = new Uint32Array(512);
  var Delaunator = class _Delaunator {
    /**
     * Constructs a delaunay triangulation object given an array of points (`[x, y]` by default).
     * `getX` and `getY` are optional functions of the form `(point) => value` for custom point formats.
     *
     * @template P
     * @param {P[]} points
     * @param {(p: P) => number} [getX]
     * @param {(p: P) => number} [getY]
     */
    // @ts-expect-error TS2322
    static from(points, getX = defaultGetX, getY = defaultGetY) {
      const n = points.length;
      const coords = new Float64Array(n * 2);
      for (let i = 0; i < n; i++) {
        const p = points[i];
        coords[2 * i] = getX(p);
        coords[2 * i + 1] = getY(p);
      }
      return new _Delaunator(coords);
    }
    /**
     * Constructs a delaunay triangulation object given an array of point coordinates of the form:
     * `[x0, y0, x1, y1, ...]` (use a typed array for best performance). Duplicate points are skipped.
     *
     * @param {T} coords
     */
    constructor(coords) {
      const n = coords.length >> 1;
      if (n > 0 && typeof coords[0] !== "number") throw new Error("Expected coords to contain numbers.");
      this.coords = coords;
      const maxTriangles = Math.max(2 * n - 5, 0);
      this._triangles = new Uint32Array(maxTriangles * 3);
      this._halfedges = new Int32Array(maxTriangles * 3);
      this._hashSize = Math.ceil(Math.sqrt(n));
      this._hullPrev = new Uint32Array(n);
      this._hullNext = new Uint32Array(n);
      this._hullTri = new Uint32Array(n);
      this._hullHash = new Int32Array(this._hashSize);
      this._ids = new Uint32Array(n);
      this._dists = new Float64Array(n);
      this.trianglesLen = 0;
      this._cx = 0;
      this._cy = 0;
      this._hullStart = 0;
      this.hull = this._triangles;
      this.triangles = this._triangles;
      this.halfedges = this._halfedges;
      this.update();
    }
    /**
     * Updates the triangulation if you modified `delaunay.coords` values in place, avoiding expensive memory allocations.
     * Useful for iterative relaxation algorithms such as Lloyd's.
     */
    update() {
      const { coords, _hullPrev: hullPrev, _hullNext: hullNext, _hullTri: hullTri, _hullHash: hullHash } = this;
      const n = coords.length >> 1;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < n; i++) {
        const x = coords[2 * i];
        const y = coords[2 * i + 1];
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        this._ids[i] = i;
      }
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      let i0 = 0, i1 = 0, i2 = 0;
      for (let i = 0, minDist = Infinity; i < n; i++) {
        const d = dist(cx, cy, coords[2 * i], coords[2 * i + 1]);
        if (d < minDist) {
          i0 = i;
          minDist = d;
        }
      }
      const i0x = coords[2 * i0];
      const i0y = coords[2 * i0 + 1];
      for (let i = 0, minDist = Infinity; i < n; i++) {
        if (i === i0) continue;
        const d = dist(i0x, i0y, coords[2 * i], coords[2 * i + 1]);
        if (d < minDist && d > 0) {
          i1 = i;
          minDist = d;
        }
      }
      let i1x = coords[2 * i1];
      let i1y = coords[2 * i1 + 1];
      let minRadius = Infinity;
      for (let i = 0; i < n; i++) {
        if (i === i0 || i === i1) continue;
        const r = circumradius(i0x, i0y, i1x, i1y, coords[2 * i], coords[2 * i + 1]);
        if (r < minRadius) {
          i2 = i;
          minRadius = r;
        }
      }
      let i2x = coords[2 * i2];
      let i2y = coords[2 * i2 + 1];
      if (minRadius === Infinity) {
        for (let i = 0; i < n; i++) {
          this._dists[i] = coords[2 * i] - coords[0] || coords[2 * i + 1] - coords[1];
        }
        quicksort(this._ids, this._dists, 0, n - 1);
        const hull = new Uint32Array(n);
        let j = 0;
        for (let i = 0, d0 = -Infinity; i < n; i++) {
          const id = this._ids[i];
          const d = this._dists[id];
          if (d > d0) {
            hull[j++] = id;
            d0 = d;
          }
        }
        this.hull = hull.subarray(0, j);
        this.triangles = new Uint32Array(0);
        this.halfedges = new Int32Array(0);
        return;
      }
      if (orient2d(i0x, i0y, i1x, i1y, i2x, i2y) < 0) {
        const i = i1;
        const x = i1x;
        const y = i1y;
        i1 = i2;
        i1x = i2x;
        i1y = i2y;
        i2 = i;
        i2x = x;
        i2y = y;
      }
      const center = circumcenter(i0x, i0y, i1x, i1y, i2x, i2y);
      this._cx = center.x;
      this._cy = center.y;
      for (let i = 0; i < n; i++) {
        this._dists[i] = dist(coords[2 * i], coords[2 * i + 1], center.x, center.y);
      }
      quicksort(this._ids, this._dists, 0, n - 1);
      this._hullStart = i0;
      let hullSize = 3;
      hullNext[i0] = hullPrev[i2] = i1;
      hullNext[i1] = hullPrev[i0] = i2;
      hullNext[i2] = hullPrev[i1] = i0;
      hullTri[i0] = 0;
      hullTri[i1] = 1;
      hullTri[i2] = 2;
      hullHash.fill(-1);
      hullHash[this._hashKey(i0x, i0y)] = i0;
      hullHash[this._hashKey(i1x, i1y)] = i1;
      hullHash[this._hashKey(i2x, i2y)] = i2;
      this.trianglesLen = 0;
      this._addTriangle(i0, i1, i2, -1, -1, -1);
      for (let k = 0, xp = 0, yp = 0; k < this._ids.length; k++) {
        const i = this._ids[k];
        const x = coords[2 * i];
        const y = coords[2 * i + 1];
        if (k > 0 && Math.abs(x - xp) <= EPSILON && Math.abs(y - yp) <= EPSILON) continue;
        xp = x;
        yp = y;
        if (i === i0 || i === i1 || i === i2) continue;
        let start = 0;
        for (let j = 0, key = this._hashKey(x, y); j < this._hashSize; j++) {
          start = hullHash[(key + j) % this._hashSize];
          if (start !== -1 && start !== hullNext[start]) break;
        }
        start = hullPrev[start];
        let e = start, q;
        while (q = hullNext[e], orient2d(x, y, coords[2 * e], coords[2 * e + 1], coords[2 * q], coords[2 * q + 1]) >= 0) {
          e = q;
          if (e === start) {
            e = -1;
            break;
          }
        }
        if (e === -1) continue;
        let t = this._addTriangle(e, i, hullNext[e], -1, -1, hullTri[e]);
        hullTri[i] = this._legalize(t + 2);
        hullTri[e] = t;
        hullSize++;
        let n2 = hullNext[e];
        while (q = hullNext[n2], orient2d(x, y, coords[2 * n2], coords[2 * n2 + 1], coords[2 * q], coords[2 * q + 1]) < 0) {
          t = this._addTriangle(n2, i, q, hullTri[i], -1, hullTri[n2]);
          hullTri[i] = this._legalize(t + 2);
          hullNext[n2] = n2;
          hullSize--;
          n2 = q;
        }
        if (e === start) {
          while (q = hullPrev[e], orient2d(x, y, coords[2 * q], coords[2 * q + 1], coords[2 * e], coords[2 * e + 1]) < 0) {
            t = this._addTriangle(q, i, e, -1, hullTri[e], hullTri[q]);
            this._legalize(t + 2);
            hullTri[q] = t;
            hullNext[e] = e;
            hullSize--;
            e = q;
          }
        }
        this._hullStart = hullPrev[i] = e;
        hullNext[e] = hullPrev[n2] = i;
        hullNext[i] = n2;
        hullHash[this._hashKey(x, y)] = i;
        hullHash[this._hashKey(coords[2 * e], coords[2 * e + 1])] = e;
      }
      this.hull = new Uint32Array(hullSize);
      for (let i = 0, e = this._hullStart; i < hullSize; i++) {
        this.hull[i] = e;
        e = hullNext[e];
      }
      this.triangles = this._triangles.subarray(0, this.trianglesLen);
      this.halfedges = this._halfedges.subarray(0, this.trianglesLen);
    }
    /**
     * Calculate an angle-based key for the edge hash used for advancing convex hull.
     *
     * @param {number} x
     * @param {number} y
     * @private
     */
    _hashKey(x, y) {
      return Math.floor(pseudoAngle(x - this._cx, y - this._cy) * this._hashSize) % this._hashSize;
    }
    /**
     * Flip an edge in a pair of triangles if it doesn't satisfy the Delaunay condition.
     *
     * @param {number} a
     * @private
     */
    _legalize(a) {
      const { _triangles: triangles, _halfedges: halfedges, coords } = this;
      let i = 0;
      let ar = 0;
      while (true) {
        const b = halfedges[a];
        const a0 = a - a % 3;
        ar = a0 + (a + 2) % 3;
        if (b === -1) {
          if (i === 0) break;
          a = EDGE_STACK[--i];
          continue;
        }
        const b0 = b - b % 3;
        const al = a0 + (a + 1) % 3;
        const bl = b0 + (b + 2) % 3;
        const p0 = triangles[ar];
        const pr = triangles[a];
        const pl = triangles[al];
        const p1 = triangles[bl];
        const illegal = inCircle(
          coords[2 * p0],
          coords[2 * p0 + 1],
          coords[2 * pr],
          coords[2 * pr + 1],
          coords[2 * pl],
          coords[2 * pl + 1],
          coords[2 * p1],
          coords[2 * p1 + 1]
        );
        if (illegal) {
          triangles[a] = p1;
          triangles[b] = p0;
          const hbl = halfedges[bl];
          if (hbl === -1) {
            let e = this._hullStart;
            do {
              if (this._hullTri[e] === bl) {
                this._hullTri[e] = a;
                break;
              }
              e = this._hullPrev[e];
            } while (e !== this._hullStart);
          }
          this._link(a, hbl);
          this._link(b, halfedges[ar]);
          this._link(ar, bl);
          const br = b0 + (b + 1) % 3;
          if (i < EDGE_STACK.length) {
            EDGE_STACK[i++] = br;
          }
        } else {
          if (i === 0) break;
          a = EDGE_STACK[--i];
        }
      }
      return ar;
    }
    /**
     * Link two half-edges to each other.
     * @param {number} a
     * @param {number} b
     * @private
     */
    _link(a, b) {
      this._halfedges[a] = b;
      if (b !== -1) this._halfedges[b] = a;
    }
    /**
     * Add a new triangle given vertex indices and adjacent half-edge ids.
     *
     * @param {number} i0
     * @param {number} i1
     * @param {number} i2
     * @param {number} a
     * @param {number} b
     * @param {number} c
     * @private
     */
    _addTriangle(i0, i1, i2, a, b, c) {
      const t = this.trianglesLen;
      this._triangles[t] = i0;
      this._triangles[t + 1] = i1;
      this._triangles[t + 2] = i2;
      this._link(t, a);
      this._link(t + 1, b);
      this._link(t + 2, c);
      this.trianglesLen += 3;
      return t;
    }
  };
  function pseudoAngle(dx, dy) {
    const p = dx / (Math.abs(dx) + Math.abs(dy));
    return (dy > 0 ? 3 - p : 1 + p) / 4;
  }
  function dist(ax, ay, bx, by) {
    const dx = ax - bx;
    const dy = ay - by;
    return dx * dx + dy * dy;
  }
  function inCircle(ax, ay, bx, by, cx, cy, px, py) {
    const dx = ax - px;
    const dy = ay - py;
    const ex = bx - px;
    const ey = by - py;
    const fx = cx - px;
    const fy = cy - py;
    const ap = dx * dx + dy * dy;
    const bp = ex * ex + ey * ey;
    const cp = fx * fx + fy * fy;
    return dx * (ey * cp - bp * fy) - dy * (ex * cp - bp * fx) + ap * (ex * fy - ey * fx) < 0;
  }
  function circumradius(ax, ay, bx, by, cx, cy) {
    const dx = bx - ax;
    const dy = by - ay;
    const ex = cx - ax;
    const ey = cy - ay;
    const bl = dx * dx + dy * dy;
    const cl = ex * ex + ey * ey;
    const d = 0.5 / (dx * ey - dy * ex);
    const x = (ey * bl - dy * cl) * d;
    const y = (dx * cl - ex * bl) * d;
    return x * x + y * y;
  }
  function circumcenter(ax, ay, bx, by, cx, cy) {
    const dx = bx - ax;
    const dy = by - ay;
    const ex = cx - ax;
    const ey = cy - ay;
    const bl = dx * dx + dy * dy;
    const cl = ex * ex + ey * ey;
    const d = 0.5 / (dx * ey - dy * ex);
    const x = ax + (ey * bl - dy * cl) * d;
    const y = ay + (dx * cl - ex * bl) * d;
    return { x, y };
  }
  function quicksort(ids, dists, left, right) {
    if (right - left <= 20) {
      for (let i = left + 1; i <= right; i++) {
        const temp = ids[i];
        const tempDist = dists[temp];
        let j = i - 1;
        while (j >= left && dists[ids[j]] > tempDist) ids[j + 1] = ids[j--];
        ids[j + 1] = temp;
      }
    } else {
      const median = left + right >> 1;
      let i = left + 1;
      let j = right;
      swap(ids, median, i);
      if (dists[ids[left]] > dists[ids[right]]) swap(ids, left, right);
      if (dists[ids[i]] > dists[ids[right]]) swap(ids, i, right);
      if (dists[ids[left]] > dists[ids[i]]) swap(ids, left, i);
      const temp = ids[i];
      const tempDist = dists[temp];
      while (true) {
        do
          i++;
        while (dists[ids[i]] < tempDist);
        do
          j--;
        while (dists[ids[j]] > tempDist);
        if (j < i) break;
        swap(ids, i, j);
      }
      ids[left + 1] = ids[j];
      ids[j] = temp;
      if (right - i + 1 >= j - left) {
        quicksort(ids, dists, i, right);
        quicksort(ids, dists, left, j - 1);
      } else {
        quicksort(ids, dists, left, j - 1);
        quicksort(ids, dists, i, right);
      }
    }
  }
  function swap(arr, i, j) {
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  function defaultGetX(p) {
    return p[0];
  }
  function defaultGetY(p) {
    return p[1];
  }

  // entry.js
  var import_poisson_disk_sampling = __toESM(require_poisson_disk_sampling());

  // dual-mesh/index.ts
  var TriangleMesh = class _TriangleMesh {
    static t_from_s(s) {
      return s / 3 | 0;
    }
    static s_prev_s(s) {
      return s % 3 === 0 ? s + 2 : s - 1;
    }
    static s_next_s(s) {
      return s % 3 === 2 ? s - 2 : s + 1;
    }
    // public data
    numSides;
    numSolidSides;
    numRegions;
    numSolidRegions;
    numTriangles;
    numSolidTriangles;
    numBoundaryRegions;
    // internal data that has accessors
    _halfedges;
    _triangles;
    _s_of_r;
    _vertex_t;
    _vertex_r;
    _options;
    // any other information we need to carry
    /**
     * Constructor takes partial mesh information from Delaunator and
     * constructs the rest.
     */
    constructor(init) {
      if ("points" in init) {
        this.numBoundaryRegions = init.numBoundaryPoints ?? 0;
        this.numSolidSides = init.numSolidSides ?? 0;
        this._vertex_t = [];
        this.update(init);
      } else {
        Object.assign(this, init);
      }
    }
    /**
     * Update internal data structures from Delaunator 
     */
    update(init) {
      this._vertex_r = init.points;
      this._triangles = init.delaunator.triangles;
      this._halfedges = init.delaunator.halfedges;
      this._update();
    }
    /**
     * Update internal data structures to match the input mesh.
     *
     * Use if you have updated the triangles/halfedges with Delaunator
     * and want the dual mesh to match the updated data. Note that
     * this DOES not update boundary regions or ghost elements.
     */
    _update() {
      let { _triangles, _halfedges, _vertex_r, _vertex_t } = this;
      this.numSides = _triangles.length;
      this.numRegions = _vertex_r.length;
      this.numSolidRegions = this.numRegions - 1;
      this.numTriangles = this.numSides / 3;
      this.numSolidTriangles = this.numSolidSides / 3;
      if (this._vertex_t.length < this.numTriangles) {
        const numOldTriangles = _vertex_t.length;
        const numNewTriangles = this.numTriangles - numOldTriangles;
        _vertex_t = _vertex_t.concat(new Array(numNewTriangles));
        for (let t = numOldTriangles; t < this.numTriangles; t++) {
          _vertex_t[t] = [0, 0];
        }
        this._vertex_t = _vertex_t;
      }
      this._s_of_r = new Int32Array(this.numRegions);
      for (let s = 0; s < _triangles.length; s++) {
        let endpoint = _triangles[_TriangleMesh.s_next_s(s)];
        if (this._s_of_r[endpoint] === 0 || _halfedges[s] === -1) {
          this._s_of_r[endpoint] = s;
        }
      }
      for (let s = 0; s < _triangles.length; s += 3) {
        let t = s / 3, a = _vertex_r[_triangles[s]], b = _vertex_r[_triangles[s + 1]], c = _vertex_r[_triangles[s + 2]];
        if (this.is_ghost_s(s)) {
          let dx = b[0] - a[0], dy = b[1] - a[1];
          let scale2 = 10 / Math.sqrt(dx * dx + dy * dy);
          _vertex_t[t][0] = 0.5 * (a[0] + b[0]) + dy * scale2;
          _vertex_t[t][1] = 0.5 * (a[1] + b[1]) - dx * scale2;
        } else {
          _vertex_t[t][0] = (a[0] + b[0] + c[0]) / 3;
          _vertex_t[t][1] = (a[1] + b[1] + c[1]) / 3;
        }
      }
    }
    /**
     * Construct ghost elements to complete the graph.
     */
    static addGhostStructure(init) {
      const { triangles, halfedges } = init.delaunator;
      const numSolidSides = triangles.length;
      let numUnpairedSides = 0, firstUnpairedEdge = -1;
      let s_unpaired_r = [];
      for (let s = 0; s < numSolidSides; s++) {
        if (halfedges[s] === -1) {
          numUnpairedSides++;
          s_unpaired_r[triangles[s]] = s;
          firstUnpairedEdge = s;
        }
      }
      const r_ghost = init.points.length;
      let newpoints = init.points.concat([[NaN, NaN]]);
      let r_newstart_s = new Int32Array(numSolidSides + 3 * numUnpairedSides);
      r_newstart_s.set(triangles);
      let s_newopposite_s = new Int32Array(numSolidSides + 3 * numUnpairedSides);
      s_newopposite_s.set(halfedges);
      for (let i = 0, s = firstUnpairedEdge; i < numUnpairedSides; i++, s = s_unpaired_r[r_newstart_s[_TriangleMesh.s_next_s(s)]]) {
        let s_ghost = numSolidSides + 3 * i;
        s_newopposite_s[s] = s_ghost;
        s_newopposite_s[s_ghost] = s;
        r_newstart_s[s_ghost] = r_newstart_s[_TriangleMesh.s_next_s(s)];
        r_newstart_s[s_ghost + 1] = r_newstart_s[s];
        r_newstart_s[s_ghost + 2] = r_ghost;
        let k = numSolidSides + (3 * i + 4) % (3 * numUnpairedSides);
        s_newopposite_s[s_ghost + 2] = k;
        s_newopposite_s[k] = s_ghost + 2;
      }
      return {
        numSolidSides,
        numBoundaryPoints: init.numBoundaryPoints,
        points: newpoints,
        delaunator: {
          triangles: r_newstart_s,
          halfedges: s_newopposite_s
        }
      };
    }
    // Accessors
    x_of_r(r) {
      return this._vertex_r[r][0];
    }
    y_of_r(r) {
      return this._vertex_r[r][1];
    }
    x_of_t(t) {
      return this._vertex_t[t][0];
    }
    y_of_t(t) {
      return this._vertex_t[t][1];
    }
    pos_of_r(r, out = []) {
      out.length = 2;
      out[0] = this.x_of_r(r);
      out[1] = this.y_of_r(r);
      return out;
    }
    pos_of_t(t, out = []) {
      out.length = 2;
      out[0] = this.x_of_t(t);
      out[1] = this.y_of_t(t);
      return out;
    }
    r_begin_s(s) {
      return this._triangles[s];
    }
    r_end_s(s) {
      return this._triangles[_TriangleMesh.s_next_s(s)];
    }
    t_inner_s(s) {
      return _TriangleMesh.t_from_s(s);
    }
    t_outer_s(s) {
      return _TriangleMesh.t_from_s(this._halfedges[s]);
    }
    s_next_s(s) {
      return _TriangleMesh.s_next_s(s);
    }
    s_prev_s(s) {
      return _TriangleMesh.s_prev_s(s);
    }
    s_opposite_s(s) {
      return this._halfedges[s];
    }
    s_around_t(t, s_out = []) {
      s_out.length = 3;
      for (let i = 0; i < 3; i++) {
        s_out[i] = 3 * t + i;
      }
      return s_out;
    }
    r_around_t(t, r_out = []) {
      r_out.length = 3;
      for (let i = 0; i < 3; i++) {
        r_out[i] = this._triangles[3 * t + i];
      }
      return r_out;
    }
    t_around_t(t, t_out = []) {
      t_out.length = 3;
      for (let i = 0; i < 3; i++) {
        t_out[i] = this.t_outer_s(3 * t + i);
      }
      return t_out;
    }
    s_around_r(r, s_out = []) {
      const s0 = this._s_of_r[r];
      let incoming = s0;
      s_out.length = 0;
      do {
        s_out.push(this._halfedges[incoming]);
        let outgoing = _TriangleMesh.s_next_s(incoming);
        incoming = this._halfedges[outgoing];
      } while (incoming !== -1 && incoming !== s0);
      return s_out;
    }
    r_around_r(r, r_out = []) {
      const s0 = this._s_of_r[r];
      let incoming = s0;
      r_out.length = 0;
      do {
        r_out.push(this.r_begin_s(incoming));
        let outgoing = _TriangleMesh.s_next_s(incoming);
        incoming = this._halfedges[outgoing];
      } while (incoming !== -1 && incoming !== s0);
      return r_out;
    }
    t_around_r(r, t_out = []) {
      const s0 = this._s_of_r[r];
      let incoming = s0;
      t_out.length = 0;
      do {
        t_out.push(_TriangleMesh.t_from_s(incoming));
        let outgoing = _TriangleMesh.s_next_s(incoming);
        incoming = this._halfedges[outgoing];
      } while (incoming !== -1 && incoming !== s0);
      return t_out;
    }
    r_ghost() {
      return this.numRegions - 1;
    }
    is_ghost_s(s) {
      return s >= this.numSolidSides;
    }
    is_ghost_r(r) {
      return r === this.numRegions - 1;
    }
    is_ghost_t(t) {
      return this.is_ghost_s(3 * t);
    }
    is_boundary_s(s) {
      return this.is_ghost_s(s) && s % 3 === 0;
    }
    is_boundary_r(r) {
      return r < this.numBoundaryRegions;
    }
  };

  // dual-mesh/create.ts
  function generateInteriorBoundaryPoints({ left, top, width, height }, boundarySpacing) {
    const epsilon2 = 1e-4;
    const curvature = 1;
    let W = Math.ceil((width - 2 * curvature) / boundarySpacing);
    let H = Math.ceil((height - 2 * curvature) / boundarySpacing);
    let points = [];
    for (let q = 0; q < W; q++) {
      let t = q / W;
      let dx = (width - 2 * curvature) * t;
      let dy = epsilon2 + curvature * 4 * (t - 0.5) ** 2;
      points.push(
        [left + curvature + dx, top + dy],
        [left + width - curvature - dx, top + height - dy]
      );
    }
    for (let r = 0; r < H; r++) {
      let t = r / H;
      let dy = (height - 2 * curvature) * t;
      let dx = epsilon2 + curvature * 4 * (t - 0.5) ** 2;
      points.push(
        [left + dx, top + height - curvature - dy],
        [left + width - dx, top + curvature + dy]
      );
    }
    return points;
  }

  // entry.js
  var import_prng = __toESM(require_prng());
  function generateMap(seed, size = "medium", opts = {}) {
    const spacing = { tiny: 38, small: 26, medium: 18, large: 12.8, huge: 9 };
    const bounds = { left: 0, top: 0, width: 1e3, height: 1e3 };
    const s = (seed | 0) & 2147483647;
    let points = generateInteriorBoundaryPoints(bounds, spacing[size]);
    const numBoundaryPoints = points.length;
    let generator = new import_poisson_disk_sampling.default({ shape: [bounds.width, bounds.height], minDistance: spacing[size] }, (0, import_prng.makeRandFloat)(s));
    for (const p of points) generator.addPoint(p);
    points = generator.fill();
    let init = { points, delaunator: Delaunator.from(points), numBoundaryPoints };
    init = TriangleMesh.addGhostStructure(init);
    const mesh = new TriangleMesh(init);
    const map = new WorldMap(new TriangleMesh(mesh), { amplitude: 0.2, length: 4, seed: s }, import_prng.makeRandInt);
    const noise = new import_simplex_noise.default((0, import_prng.makeRandFloat)(s));
    map.calculate({
      noise,
      drainageSeed: opts.variant || 0,
      riverSeed: opts.variant || 0,
      biomeBias: opts.biomeBias || { north_temperature: 0, south_temperature: 0, moisture: 0.35 },
      shape: opts.shape || { round: 0.5, inflate: 0.4, amplitudes: [1 / 2, 1 / 4, 1 / 8, 1 / 16] }
    });
    return map;
  }
  return __toCommonJS(entry_exports);
})();
