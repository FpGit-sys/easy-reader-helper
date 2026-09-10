import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadAndOpenForUser, openDownloadInBrowser, savePdfForUser } from "@/lib/native-files";
import { checkDesktopUpdate, installDesktopUpdate } from "@/lib/native-updates";

function setWindow(value: Record<string, unknown>) {
  vi.stubGlobal("window", value);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ponte nativa de arquivos", () => {
  it("envia o PDF ao comando nativo sem alterar a página", async () => {
    const invoke = vi.fn().mockResolvedValue({ path: "C:\\Downloads\\dossie.pdf", openedExternally: true });
    setWindow({ btoa, __TAURI__: { core: { invoke } } });
    const result = await savePdfForUser("dossie.pdf", new TextEncoder().encode("%PDF-1.7").buffer);
    expect(result?.openedExternally).toBe(true);
    expect(invoke).toHaveBeenCalledWith("save_pdf_and_open", {
      filename: "dossie.pdf",
      contentBase64: Buffer.from("%PDF-1.7").toString("base64"),
    });
  });

  it("abre downloads pelo backend nativo quando instalado", async () => {
    const invoke = vi.fn().mockResolvedValue({ path: "C:\\Downloads\\laudo.pdf", openedExternally: true });
    setWindow({ __TAURI__: { core: { invoke } } });
    await downloadAndOpenForUser("https://silonr.local/api/files/private?signature=x", "laudo.pdf");
    expect(invoke).toHaveBeenCalledWith("download_and_open_file", {
      url: "https://silonr.local/api/files/private?signature=x",
      filename: "laudo.pdf",
    });
  });

  it("mantém o download web em outra aba sem substituir o SiloNR", () => {
    const click = vi.fn();
    const remove = vi.fn();
    const appendChild = vi.fn();
    const link = { href: "", target: "", rel: "", click, remove };
    setWindow({});
    vi.stubGlobal("document", { createElement: () => link, body: { appendChild } });
    openDownloadInBrowser("https://example.test/file.pdf");
    expect(link.target).toBe("_blank");
    expect(link.rel).toBe("noopener noreferrer");
    expect(click).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
  });
});

describe("ponte nativa de atualizações", () => {
  it("consulta e instala somente por comandos do Desktop", async () => {
    const update = { supported: true, currentVersion: "0.3.0", available: true, version: "0.3.1" };
    const invoke = vi.fn().mockResolvedValueOnce(update).mockResolvedValueOnce(true);
    setWindow({ __TAURI__: { core: { invoke } } });
    expect(await checkDesktopUpdate()).toBe(update);
    expect(await installDesktopUpdate()).toBe(true);
    expect(invoke.mock.calls.map(([command]) => command)).toEqual(["check_for_update", "install_update"]);
  });

  it("não promete instalação automática no navegador", async () => {
    setWindow({});
    expect(await checkDesktopUpdate()).toBeNull();
    await expect(installDesktopUpdate()).rejects.toThrow("atalho instalado");
  });
});
