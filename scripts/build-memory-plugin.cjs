const MIB = 1024 * 1024;

class BuildMemoryPlugin {
  apply(compiler) {
    let timer;
    let sampledHeapPeak = 0;
    const sample = () => {
      const memory = process.memoryUsage();
      sampledHeapPeak = Math.max(sampledHeapPeak, memory.heapUsed);
      return memory;
    };
    const report = (phase) => {
      const memory = sample();
      console.log("[build-memory]", JSON.stringify({
        compiler: compiler.name,
        pid: process.pid,
        phase,
        heapUsedMiB: Math.ceil(memory.heapUsed / MIB),
        sampledHeapPeakMiB: Math.ceil(sampledHeapPeak / MIB),
        rssMiB: Math.ceil(memory.rss / MIB),
        processMaxRssMiB: Math.ceil(process.resourceUsage().maxRSS / 1024),
      }));
    };
    const stop = (phase) => {
      clearInterval(timer);
      report(phase);
    };
    compiler.hooks.beforeRun.tap("BuildMemoryPlugin", () => {
      report("start");
      let samples = 0;
      timer = setInterval(() => {
        sample();
        if (++samples % 15 === 0) report("compiling");
      }, 1000);
      timer.unref();
    });
    compiler.hooks.compilation.tap("BuildMemoryPlugin", (compilation) => {
      compilation.hooks.afterOptimizeModules.tap("BuildMemoryPlugin", () => report("modules"));
      compilation.hooks.afterOptimizeAssets.tap("BuildMemoryPlugin", () => report("assets"));
    });
    compiler.hooks.done.tap("BuildMemoryPlugin", () => stop("done"));
    compiler.hooks.failed.tap("BuildMemoryPlugin", () => stop("failed"));
  }
}

module.exports = { BuildMemoryPlugin };
