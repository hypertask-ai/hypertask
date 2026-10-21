import { Fragment, Slice } from "prosemirror-model";
import { Plugin, PluginKey } from "prosemirror-state";
import { v4 as uuidv4 } from "uuid";
import { isImageUrl } from "@/lib/media/isImageUrl";
import {
  isHeicByMetadata,
  planUploadFile,
  previewOrOriginal,
} from "@/lib/media/heicToJpeg";
import { heicPreviewUrl } from "@/lib/media/heicPreview";

export { isImageUrl };

export function isEmbeddableMediaFile(file: File | null): boolean {
  if (!file) return false;
  if (file.type.indexOf("image") === 0 || file.type.indexOf("video") === 0) {
    return true;
  }
  return isHeicByMetadata(file.type, file.name);
}

export function extractEmbeddableClipboardFiles(
  clipboardData: Pick<DataTransfer, "files"> | null | undefined,
): File[] {
  return Array.from(clipboardData?.files ?? []).filter(isEmbeddableMediaFile);
}

export const getMediaPasteDropPlugin = (options:any) => {
  let isShiftPressed = false;
  return new Plugin({
    key: new PluginKey("media-paste-drop"),
    props: {
      handleKeyDown(_view, event) {
        isShiftPressed = event.shiftKey;
        return false;
      },
      handlePaste(view, event) {
        const items = Array.from(event.clipboardData?.items || []);
        const { schema } = view.state;
        
        const mediaItems = items.filter(
          (item) => item.kind === "file" && isEmbeddableMediaFile(item.getAsFile())
        );
        
        if (mediaItems.length > 0) {
          event.preventDefault();
          
          const item = mediaItems[0];
          const file = item.getAsFile();
          
          if (!file) return false;
          
          handleFileUpload(file, view, schema, options);
          return true;
        }

        const clipboardFiles = extractEmbeddableClipboardFiles(event.clipboardData);
        if (clipboardFiles.length > 0) {
          event.preventDefault();
          handleFileUpload(clipboardFiles[0], view, schema, options);
          return true;
        }
        
        const pastedText = event.clipboardData?.getData("text/plain")?.trim();
        const inCodeBlock = view.state.selection.$from.parent.type.spec.code;
        if (!isShiftPressed && !inCodeBlock && pastedText && isImageUrl(pastedText)) {
          event.preventDefault();
          const link = schema.marks.link?.create({ href: pastedText });
          const unfurled = Fragment.fromArray([
            schema.text(pastedText, link ? [link] : undefined),
            schema.nodes.hardBreak.create(),
            schema.nodes.resizableMedia.create({
              src: pastedText,
              "media-type": "img",
            }),
          ]);
          view.dispatch(
            view.state.tr.replaceSelection(new Slice(unfurled, 0, 0))
          );
          isShiftPressed = false;
          return true;
        }

        isShiftPressed = false;

        return false;
      },
      handleDrop(view, event) {
        const hasFiles =
          event.dataTransfer &&
          event.dataTransfer.files &&
          event.dataTransfer.files.length;

        if (!hasFiles) {
          return false;
        }

        const imagesAndVideos = Array.from(
          event.dataTransfer?.files ?? []
        ).filter((file) => isEmbeddableMediaFile(file));

        if (imagesAndVideos.length === 0) return false;

        event.preventDefault();

        const { schema } = view.state;
        const coordinates = view.posAtCoords({
          left: event.clientX,
          top: event.clientY,
        });

        if (!coordinates) return false;

        imagesAndVideos.forEach((file) => {
          handleFileUpload(file, view, schema, options, coordinates.pos);
        });

        return true;
      },
    },
  });
};

function updatePlaceholder(
  view: any,
  uploadId: string,
  nextAttrs: (attrs: any) => any,
): boolean {
  const { tr } = view.state;
  let found = false;
  tr.doc.descendants((node: any, pos: any) => {
    if (found) return false;
    if (
      node.type.name === "resizableMedia" &&
      node.attrs.uploadId === uploadId
    ) {
      tr.setNodeMarkup(pos, undefined, nextAttrs(node.attrs));
      found = true;
    }
    return true;
  });
  if (found) view.dispatch(tr);
  return found;
}

async function handleFileUpload(original:any, view:any, schema:any, options:any, insertPos:number|null = null) {
  const uploadId = uuidv4();

  if (options.onUploadStart) {
    options.onUploadStart();
  }

  const mediaType =
    original.type.indexOf("video") === 0 ? "video" : "img";

  const originalObjectUrl = URL.createObjectURL(original);
  const placeholderNode = schema.nodes.resizableMedia.create({
    "media-type": mediaType,
    src: originalObjectUrl,
    isLoading: true,
    uploadId: uploadId,
    height: "auto",
  });

  const transaction = insertPos !== null 
    ? view.state.tr.insert(insertPos, placeholderNode)
    : view.state.tr.replaceSelectionWith(placeholderNode);
  
  view.dispatch(transaction);

  const plan = await planUploadFile(original);
  const file = plan.file;
  if (plan.preview) {
    updatePlaceholder(view, uploadId, (attrs) => ({
      ...attrs,
      src: URL.createObjectURL(plan.preview as File),
    }));
    URL.revokeObjectURL(originalObjectUrl);
  }

  try {
    const uploadedUrl = await options.uploadFn(file);
    const previewUrl = plan.preview
      ? heicPreviewUrl(uploadedUrl, file.type, file.name)
      : null;
    const newUrl = previewUrl ?? uploadedUrl;
    const { tr } = view.state;
    let found = false;
    
    tr.doc.descendants((node:any, pos:any) => {
      if (found) return false;
      
      if (node.type.name === 'resizableMedia' && node.attrs.uploadId === uploadId) {
        tr.setNodeMarkup(pos, undefined, {
          ...node.attrs,
          src: newUrl,
          originalSrc: previewUrl ? uploadedUrl : null,
          isLoading: false,
          uploadId: null,
        });
        found = true;
      }
      
      return true;
    });
    
    if (found) {
      view.dispatch(tr);
    }
  } catch (error) {
    console.error('Upload error:', error);
    
    const { tr } = view.state;
    let found = false;
    
    tr.doc.descendants((node:any, pos:any) => {
      if (found) return false;
      
      if (node.type.name === 'resizableMedia' && node.attrs.uploadId === uploadId) {
        tr.delete(pos, pos + node.nodeSize);
        found = true;
      }
      
      return true;
    });
    
    if (found) {
      view.dispatch(tr);
    }
  } finally {
    if (options.onUploadEnd) {
      options.onUploadEnd();
    }
  }
}
