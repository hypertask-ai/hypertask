import { useEffect } from 'react'
import useQueryState from '@/hooks/MultiPages/useQueryState';
import { REACT_QUERY_KEYS } from '@/lib/constants/constants';
import { TReturnUseFileUploadingStates } from '@/models/Contexts';

const useFileUploadingStates = (uploadingFilesKey: any[], uploadingStatesKey: string[]):TReturnUseFileUploadingStates => {
  const [uploadingFiles, setUploadingFiles] = useQueryState<any[]>(uploadingFilesKey, []);
  const [uploadInProgress, setUploadInProgress] = useQueryState<boolean>(uploadingStatesKey, false);

  useEffect(() => {
    setUploadInProgress(uploadingFiles.length > 0);

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (uploadingFiles.length > 0) {
        event.preventDefault();
        event.returnValue = '';
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };

  }, [uploadingFiles]);

  return {
    uploadingFiles,
    setUploadingFiles,
    uploadInProgress
  };
};

export default useFileUploadingStates;
