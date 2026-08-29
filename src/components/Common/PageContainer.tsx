import {FC, ReactNode} from 'react';

interface IPageContainer {
 title: string;
 children: ReactNode;

}

const PageContainer: FC<IPageContainer> = ({ title, children }) => {
 return (
    <>
        <div className='flex justify-center'>
            
            <div className='w-full max-w-[1440px] min-h-screen inbox_tag_mobile_view py-9 text-white-black px-16 flex flex-col items-start bg-containerBackground'>
                    <PageTitle title={title}/>
                {/* Render the children here */}
                {children}
            </div>
        </div>
    </>
 );
};

interface IPageTitle {
    title: string;
   }

   
const PageTitle: React.FC<IPageTitle> = ({ title }) => {
    return(
                <h1 className='hidden sm:block z-10 text-subheading'>{title}</h1>
        )
}

export default PageContainer;
