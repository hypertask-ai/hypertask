import { installShareHydrationDiagnostics } from "@/lib/telemetry/shareHydrationDiagnostics";

// Runs before Next hydrates. This narrow observer exists only on public share
// pages and stops after ten seconds, so a recurring React #418 records the DOM
// mutation that caused it instead of another opaque minified stack.
installShareHydrationDiagnostics();
