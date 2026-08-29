import { Fragment, Slice } from "prosemirror-model";
import { Plugin, PluginKey } from "prosemirror-state";
import { v4 as uuidv4 } from "uuid"; // You'll need to install this package
import { isImageUrl } from "@/lib/media/isImageUrl";

export { isImageUrl };

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
        const mediaItems = items.filter(item => {
          const file = item.getAsFile();
          return file && 
            (file.type.indexOf("image") === 0 || file.type.indexOf("video") === 0) && 
            item.kind === "file";
        });
        
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

        const imagesAndVideos = Array.from(
          event.dataTransfer?.files ?? []
        ).filter(({ type: t }) => /image|video/i.test(t));

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

// Helper function to handle file uploads
async function handleFileUpload(file:any, view:any, schema:any, options:any, insertPos:number|null = null) {
  const uploadId = uuidv4();
  const mediaType = file.type.includes("image") ? "img" : "video";
  
  // Notify that an upload is starting
  if (options.onUploadStart) {
    options.onUploadStart();
  }

  // Create a placeholder node with loading state
  const placeholderNode = schema.nodes.resizableMedia.create({
    "media-type": mediaType,
    src: URL.createObjectURL(file), // Show preview while uploading
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

  try {
    // Perform the actual upload
    const uploadedUrl = await options.uploadFn(file);
    const newUrl = uploadedUrl;
    // Find and update the placeholder node with the real URL and remove loading state
    const { tr } = view.state;
    let found = false;
    
    tr.doc.descendants((node:any, pos:any) => {
      if (found) return false;
      
      if (node.type.name === 'resizableMedia' && node.attrs.uploadId === uploadId) {
        tr.setNodeMarkup(pos, undefined, {
          ...node.attrs,
          src: newUrl,
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
