function newestFirst(rows){
  return [...rows].sort((a,b)=>(Number(b.createdAt)||0)-(Number(a.createdAt)||0));
}
module.exports={newestFirst};
