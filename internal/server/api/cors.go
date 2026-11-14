package api

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// CORSMiddleware 放行跨域请求，确保 Wails WebView 前端能调用内嵌 HTTP 服务。
//
// 背景：Wails 桌面模式下前端页面源为 wails.localhost，而内嵌 HTTP 服务监听
// 127.0.0.1:<port>，二者不同源。前端 handleSave 使用 Content-Type: application/json
// 发起 POST，这会触发 CORS 预检 (OPTIONS)。若后端不处理预检，浏览器/WebView 会
// 阻止实际请求，导致所有“导出/另存为”失败；而 multipart/form-data 的文件打开
// 属 CORS 简单请求、不触发预检，故不受影响。
//
// 本地服务仅监听 127.0.0.1，放行所有 Origin 无安全风险；远程 samoffice-server
// 模式同样需要以便浏览器直接访问。
func CORSMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		if origin := c.Request.Header.Get("Origin"); origin != "" {
			c.Header("Access-Control-Allow-Origin", origin)
			c.Header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
			c.Header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-SamCommand-Token")
			c.Header("Access-Control-Allow-Credentials", "true")
			c.Header("Access-Control-Max-Age", "86400")
		}
		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}
