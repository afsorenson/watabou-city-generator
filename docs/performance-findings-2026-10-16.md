# City Generator Performance Findings

Date: 2026-10-16. Profiled build: `792f034-51e2a08fdc`.

## Context

The user reported 8-10 seconds after New City. Investigation used temporary
in-memory profiling hooks in isolated installed Chrome sessions on the same Mac;
source files and the user's open tab were not modified. Most comparisons used
size 40, seed 1091337103, walls on. Timings vary by browser, seed, viewport, device
pixel ratio, cache state, and system load; they are not universal benchmarks.

## Measurements

| Configuration | Synchronous work | Through two animation frames |
| --- | ---: | ---: |
| Original + Flat, 1200x900 at 1x | 28 ms | 77 ms |
| Block Rows + Flat, 1200x900 at 1x | 257 ms | 283 ms |
| Block Rows + Roofed, 1200x900 at 1x | 475 ms | 1231 ms |
| One District + Roofed, 1200x900 at 1x | 677 ms | 875 ms |
| Footprints + Roofed, 1200x900 at 1x | 246 ms | 622 ms |
| Block Rows + Roofed, 1200x900 at 2x | 481-509 ms | 3356-3522 ms |
| Block Rows + Roofed, 1600x1000 at 2x | 468-493 ms | 5124-5728 ms |
| Block Rows + Flat, 1920x1200 at 2x | 251 ms | 274 ms |
| Block Rows + Roofed, 1920x1200 at 2x | 486 ms | 21762 ms (one run) |

Animation-frame timing approximates the visible update; it is not an OS-level
display latency measurement. Profiling instrumentation adds overhead. The largest
viewport had a 3840x2278 backing canvas. The 22-second observation was a single
run, not a median, but the paired Flat/Roofed result strongly implicates drawing.

The original model build took approximately 20-22 ms at the fixed seed. Block Rows
added about 208-240 ms. Roof planning added roughly 208-247 ms for 2400+ roofs.
One profiled Block Rows Roofed generation performed about 15481 clipping
intersections and 1834 differences (nested timings must not be summed).

Five actual New City clicks in a normal-DPI Chrome context painted in roughly
657-936 ms. Around 2300-2450 roof-detail Shape objects were created per city even
when none were visible at the measured screen scale. After explicit garbage
collection, heap usage settled around 39-41 MB after initial warm-up; this short
check does not prove the absence of leaks.

## Conclusions

- The original generator is not the dominant measured cost.
- High-DPI Roofed drawing is the main observed bottleneck; the measurements make
  the user's multi-second delay plausible without reproducing their exact tab.
- General polygon clipping is used for simple rectangular roof sections where a
  direct construction could avoid unnecessary operations.
- Roof detail allocation and rendering can be batched or avoided when invisible.
- Roof plans are recomputed for fresh export trees; immutable plan reuse is a
  potential optimization, provided exported pixel determinism is preserved.
- A worker could improve UI responsiveness during generation but would not solve
  the dominant measured main-thread drawing cost by itself.

## Deferred Optimization Order

1. Adapt on-screen render resolution; keep full-resolution PNG export unchanged.
2. Add a direct rectangular-roof fast path.
3. Batch visible detail drawing and avoid creating invisible detail objects.
4. Cache immutable roof plans for reuse between screen rendering and export.
5. Profile again before considering background generation.

Keep same-seed geometry hashes, Flat restoration, build-bound links, and exact
desktop/mobile export comparisons as correctness gates. The user elected to
continue frontage-driven generation first; this document does not implement or
authorize additional performance changes.