using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;
// Test-only EXEs compiled into a fresh temporary directory by smoke-program-windows.cjs.
public class ProgramWindowFixture {
    [STAThread] public static void Main(string[] args) {
        string dir=Path.GetDirectoryName(Application.ExecutablePath),name=Path.GetFileNameWithoutExtension(Application.ExecutablePath);
        var form=new Form {Text="HMM test "+name,Width=700,Height=500};
        form.Controls.Add(new TextBox {Dock=DockStyle.Top,Text="Type here after switching tabs"});
        form.FormClosing+=(sender,e)=>{if(name!="Parent"&&File.Exists(Path.Combine(dir,"refuse")))e.Cancel=true;};
        form.Shown+=(sender,e)=>{
            if(name=="Parent")File.WriteAllText(Path.Combine(dir,"parent-hwnd"),form.Handle.ToInt64().ToString());
            if(name=="First")Process.Start(new ProcessStartInfo {FileName=Path.Combine(dir,"Second.exe"),UseShellExecute=false});
        };
        Application.Run(form);
    }
}
