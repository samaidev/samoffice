package main

import (
	"fmt"
	"os"
	"os/exec"
)

func main() {
	candidates := []string{
		`C:\Program Files\LibreOffice\program\soffice.exe`,
		`C:\Progra~1\LibreOffice\program\soffice.exe`,
		`C:\Program Files (x86)\LibreOffice\program\soffice.exe`,
	}
	for _, c := range candidates {
		if _, err := os.Stat(c); err == nil {
			fmt.Println("FOUND:", c)
			return
		} else {
			fmt.Println("miss :", c, err)
		}
	}
	if p, err := exec.LookPath("soffice"); err == nil {
		fmt.Println("PATH :", p)
		return
	}
	fmt.Println("LOOKUP via where:")
	out, _ := exec.Command("cmd", "/c", "where soffice 2>nul").Output()
	fmt.Println(string(out))
}
