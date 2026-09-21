import  { useState,useEffect } from 'react'
import { IUploadingDescription } from '@/models/model';
import useQueryState from '@/hooks/MultiPages/useQueryState';
import { REACT_QUERY_KEYS } from '@/lib/constants/constants';

const useCommentAndDescriptionUploadingStates = () => {
  const [uploadingComments, setUploadingComments] = useQueryState<any[]>(REACT_QUERY_KEYS.uploadingComments, []);

  const [uploadingDescription, setUploadingDescription] = useState<IUploadingDescription>();
  const [uploadInProgress, setUploadInProgress] = useQueryState<boolean>(REACT_QUERY_KEYS.uploadStates, false);

 useEffect(() => {
  
  setUploadInProgress((uploadingComments.length === 0 && !uploadingDescription)?false:true)

  const handleBeforeUnload = (event: BeforeUnloadEvent) => {

    if (uploadingComments.length > 0 || uploadingDescription ) {
      event.preventDefault();
      console.log(event.defaultPrevented)
    }
  };

  window.addEventListener('beforeunload', handleBeforeUnload);

  return () => {
    window.removeEventListener('beforeunload', handleBeforeUnload);
  };
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [uploadingComments, uploadingDescription]);


  return {
    uploadingComments, setUploadingComments,uploadingDescription, setUploadingDescription
  }
}

export default useCommentAndDescriptionUploadingStates