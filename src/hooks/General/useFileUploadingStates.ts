import { useEffect } from 'react'
import useQueryState from '@/hooks/MultiPages/useQueryState';
import { REACT_QUERY_KEYS } from '@/lib/constants/constants';
import { TReturnUseFileUploadingStates } from '@/models/Contexts';

/**
 * A custom hook to manage file upload state and prevent page unload during active uploads.
 * 
 * This hook uses a persistent state (via `useQueryState`) to:
 * - Track a list of currently uploading files.
 * - Set a flag indicating whether an upload is in progress.
 * - Register a `beforeunload` event to prevent accidental navigation away from the page while uploads are ongoing.
 *
 * @param {any[]} uploadingFilesKey - The key used to store uploading file references (unused internally but passed for consistency).
 * @param {string[]} uploadingStatesKey - The key used to store the upload state boolean (unused internally but passed for consistency).
 * @returns {{
 *   uploadingFiles: any[],
 *   setUploadingFiles: (files: any[]) => void
 * }} An object containing the current uploading files and a setter to update them.
 */
const useFileUploadingStates = (uploadingFilesKey: any[], uploadingStatesKey: string[]):TReturnUseFileUploadingStates => {
  const [uploadingFiles, setUploadingFiles] = useQueryState<any[]>(uploadingFilesKey, []);
  const [uploadInProgress, setUploadInProgress] = useQueryState<boolean>(uploadingStatesKey, false);

  useEffect(() => {
    setUploadInProgress(uploadingFiles.length > 0);

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (uploadingFiles.length > 0) {
        event.preventDefault();
        event.returnValue = ''; // Standard way to trigger the browser's default confirmation
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadingFiles]);

  return {
    uploadingFiles,
    setUploadingFiles,
    uploadInProgress
  };
};

export default useFileUploadingStates;
