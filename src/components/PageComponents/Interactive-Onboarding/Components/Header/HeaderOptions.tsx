import { getStyle } from "@/lib/constants/InteractiveOnboarding/constants";
import { HiddenColumnLogo, PrioirtyLogo } from "@/lib/IconsLocal";
import { CSSProperties } from "react";
import { Filter, Menu } from "lucide-react";


interface Props {
  title: string;
  ownerImg: string;
  memberImgs: string[];
}

const HeaderOptions = ({ title, ownerImg, memberImgs }: Props) => {
  return (
    <div className="flex flex-grow items-center flex-row">
      <div className="relative group ">
        <Menu
          className="text-white-black min-w-[20px]"
          style={{ width: "20px", height: "20px" }}
         strokeWidth={1.75}/>
      </div>
      <span
        className="d-none d-sm-block text-white-black"
        style={{
          fontSize: "24px",
          marginLeft: "8px" }}
      >
        {title}
      </span>

      {/**----------------MEMBERS */}
      <div
        style={{
          flexDirection: "row",
          display: "flex",
          alignItems: "center",
          marginLeft: "20px" }}
      >
        <div >
          <img style={{...getStyle(ownerImg),   marginLeft:0}} src={ownerImg} alt="owner-img" className="object-cover" />
        </div>
        {memberImgs.length > 0 &&
          memberImgs.map((url, index) => (
            <div
              key={`memberimgs-${index}`}
              style={{marginLeft:'-8px'}}
            >
              <img style={getStyle(url)} src={url} alt="member-img" className="object-cover" />
            </div>
          ))}
      </div>

      {/* ======================= SET PRIORITY BUTTON ====================== */}

      <div className="mx-3 group flex gap-1 items-center relative group">
        <PrioirtyLogo className={"fill-white-black"} />
      </div>
      {/* ======================= HIDDEN COLUMNS BUTTON ====================== */}
      <span className="flex relative group gap-1 items-center">
        <HiddenColumnLogo className={`fill-white-black`} />
      </span>

      {/* ======================= FILTER HEADER ====================== */}
      <div className="mx-3 flex text-white-black  gap-1 items-center relative group">
        <Filter className={`text-white-black`}  strokeWidth={1.75}/>
      </div>
    </div>
  );
};

export default HeaderOptions;
