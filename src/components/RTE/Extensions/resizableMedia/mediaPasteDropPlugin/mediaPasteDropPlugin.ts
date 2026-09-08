import { Fragment, Slice } from "prosemirror-model";
import { Plugin, PluginKey } from "prosemirror-state";
import { v4 as uuidv4 } from "uuid"; // You'll need to install this package
import { isImageUrl } from "@/lib/media/isImageUrl";
import {
  isHeicByMetadata,
  planUploadFile,
  previewOrOriginal,
} from "@/lib/media/heicToJpeg";
import { heicPreviewUrl } from "@/lib/media/heicPreview";

export { isImageUrl };

/**
 * Whether a pasted or dropped file is one the editor should embed.
 *
 * HTPR-6264: this used to be `file.type.indexOf("image") === 0`, which asks the
 * browser what the file is and believes the answer. macOS routinely hands a
 * photo over with `type` empty or "application/octet-stream" - the rest of the
 * upload code already assumes this, which is why `needsHeicConversion` sniffs
 * bytes - and an empty type starts with neither "image" nor "video". So a HEIC
 * pasted out of Finder was silently dropped by this filter: no node was
 * inserted, no error was raised, and nothing appeared in the comment.
 *
 * The name is the signal the MIME type failed to be. Deliberately synchronous:
 * `handlePaste` has to decide before it returns whether to preventDefault.
 */
export function isEmbeddableMediaFile(file: File | null): boolean {
  if (!file) return false;
  if (file.type.indexOf("image") === 0 || file.type.indexOf("video") === 0) {
    return true;
  }
  return isHeicByMetadata(file.type, file.name);
}

export const getMediaPasteDropPlugin = (options:any) => {
  let isShiftPressed = false; // Shift+paste opts out of the URL unfurl, as in the Loom/Figma extensions
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
        
        // checking if there are any image/video files in the clipboard data
        const mediaItems = items.filter(
          (item) => item.kind === "file" && isEmbeddableMediaFile(item.getAsFile())
        );
        
        // If we have at least one media file, only process that and prevent default
        if (mediaItems.length > 0) {
          event.preventDefault();
          
          // Just process the first media item if multiple exist
          const item = mediaItems[0];
          const file = item.getAsFile();
          
          if (!file) return false;
          
          handleFileUpload(file, view, schema, options);
          return true;
        }
        
        // Pasting a bare image URL unfurls it Slack-style: the link stays, and the
        // image renders on the line below it. Shift+paste keeps just the plain URL,
        // and we never unfurl inside a code block (the media node is inline, so
        // inserting it there splits the block and mangles the code).
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

        // Let default paste handler work for other cases
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

        // Same test as paste: a Finder drag has the identical empty-MIME
        // problem, so a HEIC dropped in was being ignored too (HTPR-6264).
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

/**
 * Rewrites the still-pending placeholder node for one upload.
 *
 * The document has moved on since the node was inserted (the user keeps typing,
 * other uploads land), so the node is found by its `uploadId` rather than by
 * remembered position, and a placeholder that has since been deleted is simply
 * not found.
 */
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

// Helper function to handle file uploads
async function handleFileUpload(original:any, view:any, schema:any, options:any, insertPos:number|null = null) {
  const uploadId = uuidv4();

  // Notify that an upload is starting
  if (options.onUploadStart) {
    options.onUploadStart();
  }

  const mediaType =
    original.type.indexOf("video") === 0 ? "video" : "img";

  // The placeholder goes in before anything slow happens (HTPR-6264). Decoding
  // a HEIC pulls a 1.4 MB wasm decoder and chews through a multi-megabyte
  // photo, several seconds during which the paste had already been
  // preventDefault-ed: the editor sat there showing nothing at all, which is
  // indistinguishable from the paste having been swallowed. Inserting first
  // means the user always sees the upload appear the instant they paste.
  //
  // The original's object URL is what it starts with, which for every format
  // the browser can decode is the finished picture straight away. A HEIC paints
  // nothing from it and falls to the download chip for a moment, until the
  // decoded copy is swapped in below.
  const originalObjectUrl = URL.createObjectURL(original);
  const placeholderNode = schema.nodes.resizableMedia.create({
    "media-type": mediaType,
    src: originalObjectUrl,
    isLoading: true,
    uploadId: uploadId,
    // width: "300", // Default width for placeholder
    height: "auto",
  });

  // Insert the placeholder node
  const transaction = insertPos !== null 
    ? view.state.tr.insert(insertPos, placeholderNode)
    : view.state.tr.replaceSelectionWith(placeholderNode);
  
  view.dispatch(transaction);

  // HTPR-6264: the original is what gets uploaded and what stays downloadable;
  // the JPEG copy, when there is one, is what the editor paints.
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
    // Perform the actual upload
    const uploadedUrl = await options.uploadFn(file);
    // A HEIC's preview sits beside it in storage at a derived key, so the node
    // paints that and remembers the original for the download action. Only when
    // a copy was actually made: a conversion that failed uploaded nothing to
    // point at, and the node falls back to the download chip.
    const previewUrl = plan.preview
      ? heicPreviewUrl(uploadedUrl, file.type, file.name)
      : null;
    const newUrl = previewUrl ?? uploadedUrl;
    // Find and update the placeholder node with the real URL and remove loading state
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
    
    // Handle upload failure by marking the node with an error
    const { tr } = view.state;
    let found = false;
    
    tr.doc.descendants((node:any, pos:any) => {
      if (found) return false;
      
      if (node.type.name === 'resizableMedia' && node.attrs.uploadId === uploadId) {
        // You could either remove the node or show an error state
        tr.delete(pos, pos + node.nodeSize);
        found = true;
      }
      
      return true;
    });
    
    if (found) {
      view.dispatch(tr);
    }
  } finally {
    // Notify that the upload has finished (successful or not)
    if (options.onUploadEnd) {
      options.onUploadEnd();
    }
  }
}
