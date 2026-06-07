declare module "pdfjs-dist/build/pdf.mjs" {
  export const GlobalWorkerOptions: {
    workerSrc: string
  }

  export function getDocument(source: unknown): {
    promise: Promise<{
      numPages: number
      getPage(pageNumber: number): Promise<{
        getViewport(options: { scale: number }): { width: number; height: number }
        render(options: { canvasContext: CanvasRenderingContext2D; viewport: unknown }): { promise: Promise<void> }
      }>
    }>
  }
}
