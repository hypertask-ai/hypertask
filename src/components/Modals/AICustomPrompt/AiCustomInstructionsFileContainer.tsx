import { FC, useState } from 'react'
import { FileList } from './FileList'
import { FileUploader } from './FileUploader'
import { IAttachment } from '@/models/model'
import { useRecoilState } from '@/lib/state'
import { currentProjectAtom } from '@/store'
import axiosClient from '@/utils/axiosClient'
import toast from 'react-hot-toast'
import { useCustomAiInstructions } from '@/lib/contexts/Multipages/customAiInstructionContext'
import globalConstants from '@/lib/constants'


interface IProps {
  RAGFiles: IAttachment[]
}
const AiCustomInstructionsFileContainer: FC<IProps> = ({ RAGFiles = [] }) => {
  // Track file IDs that are currently being deleted
  const [deletingFileIds, setDeletingFileIds] = useState<Set<number>>(new Set());
  const [_currentProject, setCurrentProject] = useRecoilState(currentProjectAtom)
  const { setLoading } = useCustomAiInstructions()
  if (!_currentProject) return <></>
  const handleFileUpload = (newFiles: IAttachment[]) => {
    setCurrentProject((prev: any) => {
      if (!prev) return prev;

      // Create a proper IAiCustomInstructions object by preserving all existing fields
      const existingInstructions = prev.ai_custom_instructions?.[0] || undefined;

      return {
        ...prev,
        ai_custom_instructions: [{
          ...existingInstructions, // Keep all existing properties (id, visibility, projectId, customInstruction, etc.)
          attachments: [...(existingInstructions?.attachments || []), ...newFiles]
        }]
      };
    });
  }

  const handleFileRemove = (fileId: any) => {
    // Check if the file is already being deleted
    if (deletingFileIds.has(fileId)) {
      toast.error("File deletion already in progress");
      return;
    }
    updateAICustomInstruction(fileId);
    
  }

  const updateAICustomInstruction = (fileId: number) => {
    try {
      // Add file ID to the deleting set
      const fileFound = RAGFiles.find(x => x.id === fileId)
      if (!fileFound) return
      setDeletingFileIds(prev => new Set(prev).add(fileId));

      const response = axiosClient.delete(globalConstants.deleteFromRagAPI, {
        params: {
          fileIdToRemove: fileId,
          projectId: _currentProject.id,
          sourceUrl: fileFound.fileSource
        }
      });

      setLoading(true);

      toast.promise(response, {
        loading: "Deleting the file",
        success: () => {
          setCurrentProject((prev: any) => {
            if (!prev) return prev;

            const existingInstructions = prev.ai_custom_instructions?.[0] || undefined;

            if (!existingInstructions?.attachments) return prev;

            return {
              ...prev,
              ai_custom_instructions: [{
                ...existingInstructions,
                attachments: existingInstructions.attachments.filter(
                  (attachment: IAttachment) => attachment.id !== fileId
                )
              }]
            };
          });

          // Remove file ID from the deleting set
          setDeletingFileIds(prev => {
            const newSet = new Set(prev);
            newSet.delete(fileId);
            if (newSet.size === 0) setLoading(false);
            return newSet;
          });
          return `Successfully Deleted the file!`;
        },
        error: (error) => {
          console.log("🚀 ~ toast.promise ~ error:", error);

          // Remove file ID from the deleting set on error
          setDeletingFileIds(prev => {
            const newSet = new Set(prev);
            newSet.delete(fileId);
            if (newSet.size === 0) setLoading(false);
            return newSet;
          });
          return "Error when deleting file";
        },
      });
    } catch (error) {
      // Remove file ID from the deleting set on exception
      setDeletingFileIds(prev => {
        const newSet = new Set(prev);
        newSet.delete(fileId);
        return newSet;
      });

      setLoading(false);
      console.log("🚀 ~ updateAICustomInstruction ~ error:", error);
    }
  }

  return (
    <div className="min-w-0 flex-1 px-2">
      <div className="space-y-2 mb-4">
        <div className="flex justify-between items-center">
          <h2 className="text-subheading font-semibold">Attached files</h2>
          <span className="text-content text-muted-foreground">
            {RAGFiles.length} file{RAGFiles.length !== 1 ? "s" : ""}
          </span>
        </div>
        <p className="text-content text-muted-foreground">Upload files to provide additional context for AI.</p>
      </div>

      <FileUploader existingFiles={RAGFiles} onUpload={handleFileUpload} />

      <div className="mt-4 max-h-full">
        {RAGFiles.length > 0 ? (
          <FileList
            files={RAGFiles}
            onRemove={handleFileRemove}
            deletingFileIds={Array.from(deletingFileIds)}
          />
        ) : (
          <div className="text-center py-8 text-muted-foreground">No files uploaded yet</div>
        )}
      </div>
    </div>
  )
}

export default AiCustomInstructionsFileContainer
