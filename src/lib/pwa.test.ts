import { describe, expect, it } from "vitest";
import { webPwaAvailable } from "./pwa";
const web = {
  production: true,
  desktop: false,
  secure: true,
  protocol: "https:",
  serviceWorker: true,
};
describe("PWA registration boundary", () => {
  it("permits supported secure production web and loopback previews", () => {
    expect(webPwaAvailable(web)).toBe(true);
    expect(webPwaAvailable({ ...web, protocol: "http:" })).toBe(true);
  });
  it("never registers in native builds, including HTTPS Tauri origins", () => {
    expect(webPwaAvailable({ ...web, desktop: true })).toBe(false);
    expect(webPwaAvailable({ ...web, protocol: "tauri:" })).toBe(false);
  });
  it("never registers in development or insecure contexts", () => {
    expect(webPwaAvailable({ ...web, production: false })).toBe(false);
    expect(webPwaAvailable({ ...web, secure: false })).toBe(false);
  });
  it("does not require a worker on unsupported browsers or file URLs", () => {
    expect(webPwaAvailable({ ...web, serviceWorker: false })).toBe(false);
    expect(webPwaAvailable({ ...web, protocol: "file:" })).toBe(false);
  });
});
